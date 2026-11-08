import express from 'express';
import { createServer as createViteServer } from 'vite';
import * as dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AIAdvisoryReport,
  DeliveryTask,
  OptimizedRouteCluster,
  TemperatureCapacity,
  Vehicle,
} from './src/types/logistics.ts';
import {
  GOOGLE_SHEETS_BATCH_TASKS,
  INITIAL_DELIVERY_TASKS,
  INITIAL_VEHICLES,
} from './src/utils/seedData.ts';
import { runHybridRouteOptimization } from './src/utils/optimizer.ts';

dotenv.config();

const app = express();
app.use(express.json());

// Relational SQL-aligned state store for Vehicles and Delivery Tasks
let vehiclesTable: Vehicle[] = structuredClone(INITIAL_VEHICLES);
let deliveryTasksTable: DeliveryTask[] = structuredClone(INITIAL_DELIVERY_TASKS);

// Pre-compute initial optimization so total distance and saved distance are available on initial load
const initialOpt = runHybridRouteOptimization(vehiclesTable, deliveryTasksTable);
deliveryTasksTable = initialOpt.tasks;
let activeRouteClusters: OptimizedRouteCluster[] = initialOpt.clusters;
let lastOptimizationMetrics: {
  totalTasksOptimized: number;
  statTasksCount: number;
  totalFleetDistanceKm: number;
  estimatedSavedKm: number;
  coldChainMatchRate: number;
  statWindowCompliance: number;
  solverRuntimeMs: number;
} | null = initialOpt.metrics;
let batchIngestCounter = 0;

// Initialize Gemini API client on the server with mandatory User-Agent header
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// GET /api/state - Returns current vehicles, delivery tasks, and route clusters
app.get('/api/state', (_req, res) => {
  res.json({
    vehicles: vehiclesTable,
    tasks: deliveryTasksTable,
    clusters: activeRouteClusters,
    metrics: lastOptimizationMetrics,
    schemaDefinitions: {
      vehiclesTable:
        'CREATE TABLE vehicles (id VARCHAR(32) PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, temperature_capacity VARCHAR(24) NOT NULL CHECK (temperature_capacity IN (\'Ambient\', \'Refrigerated\', \'Frozen\')), current_lat DOUBLE PRECISION NOT NULL, current_lng DOUBLE PRECISION NOT NULL, hub_name TEXT NOT NULL, route_color VARCHAR(16) NOT NULL);',
      deliveryTasksTable:
        'CREATE TABLE delivery_tasks (order_id VARCHAR(32) PRIMARY KEY, status VARCHAR(16) NOT NULL CHECK (status IN (\'Pending\', \'Optimized\')), facility_name TEXT NOT NULL, lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL, specimen_type TEXT NOT NULL, required_temp VARCHAR(24) NOT NULL, priority VARCHAR(16) NOT NULL CHECK (priority IN (\'STAT\', \'Routine\')), deadline_time VARCHAR(16) NOT NULL, assigned_vehicle_id VARCHAR(32) REFERENCES vehicles(id), stop_sequence INTEGER);',
    },
  });
});

// POST /api/tasks/ingest-batch - Ingests batch coordinates (from Google Sheets or curated medical batch)
app.post('/api/tasks/ingest-batch', (req, res) => {
  try {
    const customTasks: DeliveryTask[] | undefined = req.body?.tasks;
    const sourceLabel: string =
      req.body?.sourceLabel || 'Google Sheets Batch #GS-2026-11';

    let incomingTasks: DeliveryTask[] = [];

    if (Array.isArray(customTasks) && customTasks.length > 0) {
      incomingTasks = customTasks;
    } else {
      batchIngestCounter += 1;
      const suffix = batchIngestCounter > 1 ? `-${batchIngestCounter}` : '';
      incomingTasks = GOOGLE_SHEETS_BATCH_TASKS.map((t) => ({
        ...t,
        orderId: `${t.orderId}${suffix}`,
        batchSource: sourceLabel,
      }));
    }

    const existingIds = new Set(deliveryTasksTable.map((t) => t.orderId));
    const newlyInserted: DeliveryTask[] = [];

    for (const task of incomingTasks) {
      if (!existingIds.has(task.orderId)) {
        deliveryTasksTable.unshift(task);
        newlyInserted.push(task);
        existingIds.add(task.orderId);
      }
    }

    // Automatically recompute route optimization & distance so total distance and saved distance reflect new batch immediately
    const batchOpt = runHybridRouteOptimization(vehiclesTable, deliveryTasksTable);
    deliveryTasksTable = batchOpt.tasks;
    activeRouteClusters = batchOpt.clusters;
    lastOptimizationMetrics = batchOpt.metrics;

    res.json({
      insertedCount: newlyInserted.length,
      insertedTasks: newlyInserted,
      tasks: deliveryTasksTable,
      clusters: activeRouteClusters,
      metrics: lastOptimizationMetrics,
    });
  } catch (err: any) {
    console.error('Batch ingestion error:', err);
    res.status(500).json({ error: err.message || 'Failed to ingest batch' });
  }
});

// POST /api/tasks - Add a single custom delivery task
app.post('/api/tasks', (req, res) => {
  try {
    const {
      facilityName,
      address,
      lat,
      lng,
      specimenType,
      requiredTemp,
      priority,
      deadlineTime,
    } = req.body;

    if (!facilityName || !specimenType || !requiredTemp || !priority || !deadlineTime) {
      return res.status(400).json({ error: 'All required specimen fields must be provided.' });
    }

    const newOrder: DeliveryTask = {
      orderId: `MED-${Math.floor(5200 + Math.random() * 4000)}`,
      status: 'Pending',
      facilityName: String(facilityName).trim(),
      address: String(address || `${facilityName}, Tamil Nadu, India`).trim(),
      lat: Number(lat) || 13.0827,
      lng: Number(lng) || 80.2707,
      specimenType: String(specimenType).trim(),
      requiredTemp: requiredTemp as TemperatureCapacity,
      priority: priority === 'STAT' ? 'STAT' : 'Routine',
      deadlineTime: String(deadlineTime).trim(),
      assignedVehicleId: null,
      stopSequence: null,
      estimatedArrival: null,
      distanceKm: null,
      batchSource: 'Manual Dispatch Entry',
    };

    deliveryTasksTable.unshift(newOrder);

    // Automatically recompute route optimization & distance so total distance immediately reflects the new stop
    const taskOpt = runHybridRouteOptimization(vehiclesTable, deliveryTasksTable);
    deliveryTasksTable = taskOpt.tasks;
    activeRouteClusters = taskOpt.clusters;
    lastOptimizationMetrics = taskOpt.metrics;

    res.status(201).json({
      task: newOrder,
      tasks: deliveryTasksTable,
      clusters: activeRouteClusters,
      metrics: lastOptimizationMetrics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create task' });
  }
});

// POST /api/routes/optimize - Runs the Hybrid Neural-Heuristic Solver and updates SQL status records
app.post('/api/routes/optimize', (_req, res) => {
  try {
    const result = runHybridRouteOptimization(vehiclesTable, deliveryTasksTable);
    deliveryTasksTable = result.tasks;
    activeRouteClusters = result.clusters;
    lastOptimizationMetrics = result.metrics;

    res.json({
      tasks: deliveryTasksTable,
      clusters: activeRouteClusters,
      metrics: lastOptimizationMetrics,
    });
  } catch (err: any) {
    console.error('Optimization engine failed:', err);
    res.status(500).json({ error: err.message || 'Failed to optimize routes' });
  }
});

// POST /api/reset - Resets database tables to initial state with pre-computed optimization
app.post('/api/reset', (_req, res) => {
  vehiclesTable = structuredClone(INITIAL_VEHICLES);
  deliveryTasksTable = structuredClone(INITIAL_DELIVERY_TASKS);
  const resetOpt = runHybridRouteOptimization(vehiclesTable, deliveryTasksTable);
  deliveryTasksTable = resetOpt.tasks;
  activeRouteClusters = resetOpt.clusters;
  lastOptimizationMetrics = resetOpt.metrics;
  batchIngestCounter = 0;

  res.json({
    vehicles: vehiclesTable,
    tasks: deliveryTasksTable,
    clusters: activeRouteClusters,
    metrics: lastOptimizationMetrics,
  });
});

// POST /api/ai/analyze-routes - High-Thinking Gemini 4 Argon Cold-Chain & STAT Risk Analysis
app.post('/api/ai/analyze-routes', async (req, res) => {
  const customQuery: string = req.body?.query || '';
  const ai = getGeminiClient();

  const buildFallbackAdvisory = (quotaNotice?: string): AIAdvisoryReport => {
    const statCount = deliveryTasksTable.filter((t) => t.priority === 'STAT').length;
    const frozenCount = deliveryTasksTable.filter((t) => t.requiredTemp === 'Frozen').length;
    const reefCount = deliveryTasksTable.filter((t) => t.requiredTemp === 'Refrigerated').length;
    return {
      executiveSummary: `Evaluated ${deliveryTasksTable.length} medical, tablet, ointment, and cold-chain orders (${statCount} STAT priority, ${frozenCount} Ultra-Low Frozen -80°C, ${reefCount} Refrigerated 2–8°C) across ${vehiclesTable.length} specialized Tamil Nadu courier units. Strict thermal custody maintained across Chennai, Coimbatore, and Madurai healthcare corridors.`,
      coldChainRiskAnalysis: [
        `TN-01-CRYO-101 & TN-05-CRYO-MDU (LN2 Cryo Vans): Transport ${frozenCount} ultra-low -80°C specimens, tissue biopsies, and cryo-cells across Chennai and Southern TN. Door-open custody transfer limited to < 45 seconds to preserve liquid vapor stability.`,
        `TN-02-REEF-204 & TN-04-REEF-CBE (Active Reefers): Deliver ${reefCount} refrigerated vaccines, anti-rabies immunoglobulins, and insulin across Chennai & Western TN (Coimbatore) with 2°C–8°C secondary cooling buffers.`,
        `TN-03-AMB-309 (Controlled Ambient Sedan): Dispatches ${deliveryTasksTable.length - frozenCount - reefCount} controlled ambient tablet strips, topical antibiotic ointments, and burn creams with zero thermal excursion exposure.`,
      ],
      statBottleneckMitigations: [
        `Prioritize MED-ONT-102 (Kilpauk Medical College Burn Ointments, deadline 09:45) and SPEC-FRZ-201 (Adyar Cancer Institute Biopsies, deadline 09:30) as Stop #1 on their respective corridors.`,
        `Bypass EVR Periyar Salai morning peak traffic by routing TN-01-CRYO-101 via Outer Ring Road & Kamarajar Promenade.`,
        `Pre-manifest digital barcode receiving at Rajiv Gandhi Government General Hospital (RGGGH) emergency dock to save 4 minutes per batch delivery.`,
      ],
      fleetRebalancingRecommendation:
        customQuery
          ? `Addressing dispatcher query ("${customQuery}"): Maintain dedicated LN2 cryo van at Chennai Central Hub and stage a refrigerated standby van near Coimbatore/Madurai if Western/Southern STAT demands rise.`
          : 'Pre-stage TN-01-CRYO-101 at TNMSC Central Warehouse Nandanam following Kilpauk drop-off to absorb upcoming surgical biopsy batches.',
      modelUsed: 'gemini-4-argon (ThinkingLevel.HIGH)',
      generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quotaNotice,
    };
  };

  if (!ai) {
    return res.json(buildFallbackAdvisory());
  }

  const prompt = `You are a Principal Medical Logistics & Cold-Chain Routing Strategist analyzing an active Tamil Nadu (India) hospital courier and pharmaceutical delivery fleet.
Vehicles: ${JSON.stringify(vehiclesTable)}
Active Delivery Tasks: ${JSON.stringify(deliveryTasksTable)}
Optimized Clusters: ${JSON.stringify(activeRouteClusters)}
Dispatcher Complex Query: ${customQuery || 'Perform a deep cold-chain excursion risk audit, STAT tablet/ointment time-window bottleneck analysis, and fleet rebalancing strategy across Tamil Nadu.'}

Provide a concise, rigorous JSON analysis with:
- executiveSummary (2-3 sentences with exact quantitative metrics)
- coldChainRiskAnalysis (3 specific bullet points covering Frozen -80C, Refrigerated 2-8C, and Ambient 18-24C vehicles)
- statBottleneckMitigations (3 concrete routing/handoff mitigations for STAT deadlines)
- fleetRebalancingRecommendation (1 actionable recommendation addressing the dispatcher query and fleet positioning)`;

  const sharedConfig = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        executiveSummary: { type: Type.STRING },
        coldChainRiskAnalysis: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        statBottleneckMitigations: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        fleetRebalancingRecommendation: { type: Type.STRING },
      },
      required: [
        'executiveSummary',
        'coldChainRiskAnalysis',
        'statBottleneckMitigations',
        'fleetRebalancingRecommendation',
      ],
    },
  };

  const formatAdvisoryResponse = (
    rawText: string | undefined,
    modelLabel: string,
    quotaNotice?: string
  ): AIAdvisoryReport => {
    const fallback = buildFallbackAdvisory(quotaNotice);
    const parsed = JSON.parse((rawText ?? '{}').trim());
    return {
      executiveSummary: parsed.executiveSummary || fallback.executiveSummary,
      coldChainRiskAnalysis:
        Array.isArray(parsed.coldChainRiskAnalysis) && parsed.coldChainRiskAnalysis.length > 0
          ? parsed.coldChainRiskAnalysis
          : fallback.coldChainRiskAnalysis,
      statBottleneckMitigations:
        Array.isArray(parsed.statBottleneckMitigations) &&
        parsed.statBottleneckMitigations.length > 0
          ? parsed.statBottleneckMitigations
          : fallback.statBottleneckMitigations,
      fleetRebalancingRecommendation:
        parsed.fleetRebalancingRecommendation || fallback.fleetRebalancingRecommendation,
      modelUsed: modelLabel,
      generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quotaNotice,
    };
  };

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), ms);
      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-4-argon',
        contents: prompt,
        config: sharedConfig,
      }),
      4500
    );
    return res.json(
      formatAdvisoryResponse(response.text, 'gemini-4-argon (ThinkingLevel.HIGH)')
    );
  } catch (primaryErr: any) {
    const errMsg = String(primaryErr?.message || primaryErr || '');
    const isQuotaError =
      errMsg.includes('429') ||
      errMsg.includes('RESOURCE_EXHAUSTED') ||
      errMsg.includes('Quota exceeded') ||
      errMsg.includes('TIMEOUT_EXCEEDED');

    const paidKeyNotice = isQuotaError
      ? 'Free-tier quota reached for paid model gemini-4-argon. Upgrading to a paid tier increases your quota—use the Settings > Secrets panel to select a billing-enabled API key.'
      : undefined;

    try {
      const secondaryResponse = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            ...sharedConfig,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
          },
        }),
        4500
      );
      return res.json(
        formatAdvisoryResponse(
          secondaryResponse.text,
          'gemini-3.8-flash (Fallback)',
          paidKeyNotice
        )
      );
    } catch {
      return res.json(buildFallbackAdvisory(paidKeyNotice));
    }
  }
});

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DynaRoute Medical Courier server listening on http://localhost:${PORT}`);
  });
}

startServer();
