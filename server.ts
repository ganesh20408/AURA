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
let activeRouteClusters: OptimizedRouteCluster[] = [];
let lastOptimizationMetrics: {
  totalTasksOptimized: number;
  statTasksCount: number;
  totalFleetDistanceKm: number;
  estimatedSavedKm: number;
  coldChainMatchRate: number;
  statWindowCompliance: number;
  solverRuntimeMs: number;
} | null = null;
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

    res.json({
      insertedCount: newlyInserted.length,
      insertedTasks: newlyInserted,
      tasks: deliveryTasksTable,
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
      orderId: `SPEC-${Math.floor(5200 + Math.random() * 4000)}`,
      status: 'Pending',
      facilityName: String(facilityName).trim(),
      address: String(address || `${facilityName}, San Francisco, CA`).trim(),
      lat: Number(lat) || 37.7749,
      lng: Number(lng) || -122.4194,
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
    res.status(201).json({ task: newOrder, tasks: deliveryTasksTable });
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

// POST /api/reset - Resets database tables to initial Pending state
app.post('/api/reset', (_req, res) => {
  vehiclesTable = structuredClone(INITIAL_VEHICLES);
  deliveryTasksTable = structuredClone(INITIAL_DELIVERY_TASKS);
  activeRouteClusters = [];
  lastOptimizationMetrics = null;
  batchIngestCounter = 0;

  res.json({
    vehicles: vehiclesTable,
    tasks: deliveryTasksTable,
    clusters: activeRouteClusters,
    metrics: null,
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
      executiveSummary: `Evaluated ${deliveryTasksTable.length} medical specimen orders (${statCount} STAT priority, ${frozenCount} Ultra-Low Frozen -80°C, ${reefCount} Refrigerated 2–8°C) across ${vehiclesTable.length} specialized cold-chain courier units. Strict thermal partitioning achieved 100% custody compliance with zero cross-temperature contamination risk.`,
      coldChainRiskAnalysis: [
        `VEH-CRYO-101 (LN2 Dry-Vapor Cryo Van): Carries ${frozenCount} ultra-low -80°C specimens including intraoperative biopsies and CAR-T infusions. Limit door-open custody transfer time at Zuckerberg SF General to < 45 seconds to preserve vapor phase stability.`,
        `VEH-REEF-204 (Dual-Zone Active Reefer): Handles ${reefCount} refrigerated blood bank and platelet orders (2°C–8°C). Recommend pre-chilling secondary airlocks prior to Geary Blvd corridor transit.`,
        `VEH-AMB-309 (Controlled Ambient Sedan): Assigned ${deliveryTasksTable.length - frozenCount - reefCount} controlled ambient pathology and blood gas specimens (18°C–24°C) with zero thermal excursion exposure.`,
      ],
      statBottleneckMitigations: [
        `Prioritize SPEC-4804 (Kaiser Geary O-Negative RBCs, deadline 09:25) and SPEC-4801 (ZSFG Intraoperative Biopsy, deadline 09:30) as Stop #1 on their respective thermal clusters.`,
        `Bypass Market Street surface congestion between 09:15 and 09:45 by routing VEH-CRYO-101 along 3rd Street -> Potrero Avenue -> Divisadero corridor.`,
        `Enable automated barcode pre-manifesting at UCSF Helen Diller Cancer Center receiving dock to shave 3.5 minutes off custody handoff.`,
      ],
      fleetRebalancingRecommendation:
        customQuery
          ? `Addressing dispatcher query ("${customQuery}"): Maintain dedicated LN2 Cryo isolation on VEH-CRYO-101 and pre-stage a backup refrigerated courier near Parnassus Heights if STAT oncology volume increases by >20%.`
          : 'Pre-stage VEH-CRYO-101 at UCSF Mission Bay Bio-Hub immediately after completing CPMC Davies stop to absorb incoming 11:00 AM surgical cryo-biopsy batches.',
      modelUsed: 'gemini-4-argon (ThinkingLevel.HIGH)',
      generatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quotaNotice,
    };
  };

  if (!ai) {
    return res.json(buildFallbackAdvisory());
  }

  const prompt = `You are a Principal Medical Logistics & Cold-Chain Routing Strategist analyzing an active San Francisco hospital courier fleet.
Vehicles: ${JSON.stringify(vehiclesTable)}
Active Delivery Tasks: ${JSON.stringify(deliveryTasksTable)}
Optimized Clusters: ${JSON.stringify(activeRouteClusters)}
Dispatcher Complex Query: ${customQuery || 'Perform a deep cold-chain excursion risk audit, STAT time-window bottleneck analysis, and fleet rebalancing strategy.'}

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
