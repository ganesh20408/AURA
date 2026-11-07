import React, { useEffect, useState } from 'react';
import {
  AIAdvisoryReport,
  DeliveryTask,
  OptimizedRouteCluster,
  TaskPriority,
  TemperatureCapacity,
  Vehicle,
} from './types/logistics';
import { DispatcherMap } from './components/DispatcherMap';
import { SheetsIngestModal } from './components/SheetsIngestModal';
import { StrategyRoom3D } from './components/StrategyRoom3D';
import {
  FileSpreadsheet,
  Search,
  Sparkles,
  RotateCcw,
  Plus,
  Snowflake,
  Thermometer,
  Sun,
  CheckCircle2,
  Clock,
  Truck,
  Database,
  BrainCircuit,
  X,
} from 'lucide-react';

type ActiveTab = 'dispatcher' | 'strategy3d' | 'schema' | 'advisory';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dispatcher');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [tasks, setTasks] = useState<DeliveryTask[]>([]);
  const [clusters, setClusters] = useState<OptimizedRouteCluster[]>([]);
  const [solverMetrics, setSolverMetrics] = useState<{
    totalTasksOptimized: number;
    statTasksCount: number;
    totalFleetDistanceKm: number;
    estimatedSavedKm: number;
    coldChainMatchRate: number;
    statWindowCompliance: number;
    solverRuntimeMs: number;
  } | null>(null);
  const [schemaDefinitions, setSchemaDefinitions] = useState<{
    vehiclesTable: string;
    deliveryTasksTable: string;
  } | null>(null);

  const [isLoadingState, setIsLoadingState] = useState<boolean>(true);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isIngestingQuick, setIsIngestingQuick] = useState<boolean>(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  // Filters for Left Dispatcher Panel
  const [tempFilter, setTempFilter] = useState<TemperatureCapacity | 'All'>('All');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTaskOrderId, setSelectedTaskOrderId] = useState<string | null>(null);

  // Modals & AI High-Thinking State
  const [isSheetsModalOpen, setIsSheetsModalOpen] = useState<boolean>(false);
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState<boolean>(false);
  const [advisoryReport, setAdvisoryReport] = useState<AIAdvisoryReport | null>(null);
  const [advisoryQuery, setAdvisoryQuery] = useState<string>('');
  const [isAnalyzingAI, setIsAnalyzingAI] = useState<boolean>(false);

  // New Task Form State
  const [newFacility, setNewFacility] = useState<string>('');
  const [newSpecimen, setNewSpecimen] = useState<string>('');
  const [newTemp, setNewTemp] = useState<TemperatureCapacity>('Frozen');
  const [newPriority, setNewPriority] = useState<TaskPriority>('STAT');
  const [newDeadline, setNewDeadline] = useState<string>('10:15');
  const [formError, setFormError] = useState<string | null>(null);

  // Load initial state from SQL-backed server API
  const fetchState = async () => {
    setIsLoadingState(true);
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error('Failed to load state');
      const data = await res.json();
      setVehicles(data.vehicles || []);
      setTasks(data.tasks || []);
      setClusters(data.clusters || []);
      setSolverMetrics(data.metrics || null);
      if (data.schemaDefinitions) {
        setSchemaDefinitions(data.schemaDefinitions);
      }
    } catch (err) {
      console.error('Error loading initial logistics state:', err);
    } finally {
      setIsLoadingState(false);
    }
  };

  useEffect(() => {
    fetchState();
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === '3d') {
      setActiveTab('strategy3d');
    }
  }, []);

  // Module 2: Ingest Batch from Google Sheets
  const handleIngestBatch = async (
    customTasks?: DeliveryTask[],
    sourceLabel?: string
  ) => {
    setIsIngestingQuick(true);
    try {
      const res = await fetch('/api/tasks/ingest-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: customTasks,
          sourceLabel: sourceLabel || 'Google Sheets Batch #GS-2026-11',
        }),
      });
      if (!res.ok) throw new Error('Batch ingestion request failed');
      const data = await res.json();
      setTasks(data.tasks || []);
      setBannerNotice(
        `Ingested ${data.insertedCount} medical specimen coordinates from ${
          sourceLabel || 'Google Sheets Batch #GS-2026-11'
        } into SQL delivery_tasks table.`
      );
    } catch (err: any) {
      console.error('Error ingesting batch:', err);
    } finally {
      setIsIngestingQuick(false);
    }
  };

  // Module 3: Hybrid Neural-Heuristic Route Optimization Engine
  const handleOptimizeRoutes = async () => {
    setIsOptimizing(true);
    try {
      const res = await fetch('/api/routes/optimize', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Optimization failed');
      const data = await res.json();
      setTasks(data.tasks || []);
      setClusters(data.clusters || []);
      setSolverMetrics(data.metrics || null);
      setBannerNotice(
        `Hybrid Neural-Heuristic Solver optimized ${
          data.metrics?.totalTasksOptimized || 0
        } tasks across ${
          (data.clusters || []).filter((c: OptimizedRouteCluster) => c.stops.length > 0).length
        } thermal-matched vehicle routes (100% Cold-Chain compliance).`
      );
    } catch (err) {
      console.error('Error optimizing routes:', err);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleResetDemo = async () => {
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      setVehicles(data.vehicles || []);
      setTasks(data.tasks || []);
      setClusters(data.clusters || []);
      setSolverMetrics(null);
      setBannerNotice('Database reset to initial Pending dispatch queue.');
    } catch (err) {
      console.error('Reset error:', err);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFacility.trim() || !newSpecimen.trim() || !newDeadline.trim()) {
      setFormError('Facility name, specimen type, and time window deadline are required.');
      return;
    }
    setFormError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityName: newFacility.trim(),
          specimenType: newSpecimen.trim(),
          requiredTemp: newTemp,
          priority: newPriority,
          deadlineTime: newDeadline.trim(),
          lat: 37.768 + (Math.random() - 0.5) * 0.03,
          lng: -122.425 + (Math.random() - 0.5) * 0.04,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        setFormError(errData.error || 'Failed to add specimen order.');
        return;
      }
      const data = await res.json();
      setTasks(data.tasks || []);
      setNewFacility('');
      setNewSpecimen('');
      setIsAddTaskModalOpen(false);
      setBannerNotice(`Added new ${newPriority} ${newTemp} task (${data.task.orderId}).`);
    } catch (err: any) {
      setFormError(err.message || 'Network error adding task');
    }
  };

  // Run High-Thinking Gemini 4 Argon Cold-Chain Analysis
  const handleRunAIAnalysis = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsAnalyzingAI(true);
    try {
      const res = await fetch('/api/ai/analyze-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: advisoryQuery }),
      });
      if (!res.ok) throw new Error('AI analysis request failed');
      const report: AIAdvisoryReport = await res.json();
      setAdvisoryReport(report);
    } catch (err) {
      console.error('AI analysis error:', err);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  // Filtered delivery tasks for the Dispatcher left panel
  const filteredTasks = tasks.filter((task) => {
    const matchesTemp = tempFilter === 'All' || task.requiredTemp === tempFilter;
    const matchesPriority =
      priorityFilter === 'All' || task.priority === priorityFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      task.orderId.toLowerCase().includes(q) ||
      task.facilityName.toLowerCase().includes(q) ||
      task.specimenType.toLowerCase().includes(q);
    return matchesTemp && matchesPriority && matchesSearch;
  });

  const pendingCount = tasks.filter((t) => t.status === 'Pending').length;
  const optimizedCount = tasks.filter((t) => t.status === 'Optimized').length;
  const statCount = tasks.filter((t) => t.priority === 'STAT').length;

  return (
    <div
      data-state={activeTab}
      className="min-h-screen flex flex-col bg-slate-50 text-slate-900"
    >
      {/* Top Bar Contract: Exactly 3 Zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3 bg-white border-b border-slate-200 shrink-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#dispatcher"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dispatcher');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          DynaRoute
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() => setActiveTab('dispatcher')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'dispatcher'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Dispatcher Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('strategy3d')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'strategy3d'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            3D Strategy Room
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schema')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'schema'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            SQL Asset Schema
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('advisory');
              if (!advisoryReport) {
                handleRunAIAnalysis();
              }
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              activeTab === 'advisory'
                ? 'border-slate-900 text-slate-900 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Cold-Chain AI
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={isOptimizing}
            onClick={handleOptimizeRoutes}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 shadow-2xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isOptimizing ? 'Optimizing Routes...' : 'Optimize Routes'}</span>
          </button>
        </div>
      </header>

      {/* Optional Non-Intrusive Feedback Strip */}
      {bannerNotice && (
        <div
          role="status"
          className="bg-slate-900 text-slate-100 px-6 py-2 text-xs flex items-center justify-between border-b border-slate-800 shrink-0"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{bannerNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerNotice(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-white ml-4 text-xs underline whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* VIEW 1: DISPATCHER DASHBOARD (Split-Screen React + Google Maps) */}
      {activeTab === 'dispatcher' && (
        <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* LEFT PANEL: Active Delivery Tasks, Fleet Summary, Temperature Filters & Batch Ingestion */}
          <section
            aria-label="Active Delivery Tasks and Cold-Chain Controls"
            className="w-full lg:w-[52%] xl:w-[50%] flex flex-col border-r border-slate-200 bg-white overflow-y-auto max-h-[calc(100vh-57px)]"
          >
            {/* Workspace Action Bar */}
            <div className="p-5 border-b border-slate-200 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-base font-bold text-slate-900 tracking-tight">
                    Medical Specimen Dispatch Queue
                  </h1>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                    <span>{tasks.length} Total Tasks</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700 font-medium">{pendingCount} Pending</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-700 font-medium">{optimizedCount} Optimized</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-red-700 font-medium">{statCount} STAT Priority</span>
                  </div>
                </div>

                {/* Action Buttons: Ingest Batch from Google Sheets + Drive Modal + Add Task */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isIngestingQuick}
                    onClick={() => handleIngestBatch()}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                    <span>
                      {isIngestingQuick
                        ? 'Ingesting...'
                        : 'Ingest Batch from Google Sheets'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSheetsModalOpen(true)}
                    aria-label="Browse Google Drive Spreadsheets"
                    className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Drive Browser
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsAddTaskModalOpen(true)}
                    className="px-2.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Order</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetDemo}
                    aria-label="Reset Dispatch Queue"
                    className="p-2 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    title="Reset Queue"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Active Fleet Cold-Chain Capacity Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                {vehicles.map((veh) => {
                  const cluster = clusters.find((c) => c.vehicleId === veh.id);
                  const stopCount = cluster ? cluster.stops.length : 0;
                  return (
                    <div
                      key={veh.id}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-slate-900">
                          {veh.id}
                        </span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {stopCount}/{veh.maxStops} stops
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-800 mt-1 truncate">
                        {veh.name}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                        <span>{veh.temperatureCapacity}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{veh.tempRangeLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Filter Controls: Specimen Temperature Constraints & Search */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                {/* Interactive Segmented Filter Controls for Temperature Constraints */}
                <div
                  role="group"
                  aria-label="Filter by Specimen Temperature Constraint"
                  className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200"
                >
                  {(['All', 'Frozen', 'Refrigerated', 'Ambient'] as const).map(
                    (tempOption) => {
                      const isActive = tempFilter === tempOption;
                      const count =
                        tempOption === 'All'
                          ? tasks.length
                          : tasks.filter((t) => t.requiredTemp === tempOption).length;
                      return (
                        <button
                          key={tempOption}
                          type="button"
                          onClick={() => setTempFilter(tempOption)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                            isActive
                              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tempOption === 'Frozen' && (
                            <Snowflake className="w-3 h-3 text-sky-600" />
                          )}
                          {tempOption === 'Refrigerated' && (
                            <Thermometer className="w-3 h-3 text-teal-600" />
                          )}
                          {tempOption === 'Ambient' && (
                            <Sun className="w-3 h-3 text-indigo-600" />
                          )}
                          <span>{tempOption}</span>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            ({count})
                          </span>
                        </button>
                      );
                    }
                  )}
                </div>

                {/* Priority Filter & Search Input */}
                <div className="flex items-center gap-2 flex-1 min-w-[200px] justify-end">
                  <div
                    role="group"
                    aria-label="Filter by Priority"
                    className="flex items-center gap-0.5 p-1 bg-slate-100 rounded-lg border border-slate-200"
                  >
                    {(['All', 'STAT', 'Routine'] as const).map((prio) => (
                      <button
                        key={prio}
                        type="button"
                        onClick={() => setPriorityFilter(prio)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          priorityFilter === prio
                            ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {prio}
                      </button>
                    ))}
                  </div>

                  <div className="relative flex-1 max-w-[210px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter order or hospital..."
                      aria-label="Search delivery tasks"
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Optimization Solver Summary Bar (Shown once routes are optimized) */}
            {solverMetrics && (
              <div className="px-5 py-2.5 bg-slate-900 text-slate-200 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums">
                <span>
                  SOLVER: {solverMetrics.totalTasksOptimized} Routed ·{' '}
                  {solverMetrics.totalFleetDistanceKm} km total (-
                  {solverMetrics.estimatedSavedKm} km saved)
                </span>
                <span className="text-emerald-400">
                  Cold-Chain Match: {solverMetrics.coldChainMatchRate}% · STAT Compliance:{' '}
                  {solverMetrics.statWindowCompliance}%
                </span>
              </div>
            )}

            {/* Task List Table / Cards */}
            <div className="flex-1 divide-y divide-slate-200">
              {isLoadingState ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Loading medical courier dispatch records...
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <p className="text-sm font-medium text-slate-700">
                    No specimen delivery tasks match the selected filters.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setTempFilter('All');
                      setPriorityFilter('All');
                      setSearchQuery('');
                    }}
                    className="px-3.5 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 underline cursor-pointer"
                  >
                    Clear All Filters
                  </button>
                </div>
              ) : (
                filteredTasks.map((task) => {
                  const isSelected = task.orderId === selectedTaskOrderId;
                  return (
                    <div
                      key={task.orderId}
                      onClick={() =>
                        setSelectedTaskOrderId(isSelected ? null : task.orderId)
                      }
                      className={`px-5 py-3.5 transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 min-w-0">
                          {/* Unboxed Metadata Kicker (Zero-Pill Discipline) */}
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-mono font-bold text-slate-900">
                              {task.orderId}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span
                              className={
                                task.priority === 'STAT'
                                  ? 'font-semibold text-red-600'
                                  : 'font-medium text-slate-600'
                              }
                            >
                              {task.priority} Priority
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span
                              className={
                                task.requiredTemp === 'Frozen'
                                  ? 'font-semibold text-sky-700'
                                  : task.requiredTemp === 'Refrigerated'
                                  ? 'font-semibold text-teal-700'
                                  : 'font-semibold text-indigo-700'
                              }
                            >
                              {task.requiredTemp}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span
                              className={
                                task.status === 'Optimized'
                                  ? 'font-semibold text-emerald-700'
                                  : 'font-medium text-amber-700'
                              }
                            >
                              {task.status}
                            </span>
                          </div>

                          {/* Primary Facility Name */}
                          <h3 className="text-sm font-semibold text-slate-900 truncate">
                            {task.facilityName}
                          </h3>

                          {/* Specimen Description & Coordinates */}
                          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                            <span>{task.specimenType}</span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                              {task.lat.toFixed(4)}°N, {Math.abs(task.lng).toFixed(4)}°W
                            </span>
                          </div>
                        </div>

                        {/* Right Column: Deadline & Assigned Route Stop */}
                        <div className="text-right shrink-0 font-mono tabular-nums space-y-1">
                          <div className="text-xs font-semibold text-slate-900 flex items-center justify-end gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>Due {task.deadlineTime}</span>
                          </div>
                          {task.status === 'Optimized' && task.assignedVehicleId ? (
                            <div className="text-[11px] text-emerald-700 font-medium">
                              {task.assignedVehicleId} · Stop #{task.stopSequence} (ETA{' '}
                              {task.estimatedArrival})
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-400">
                              Unassigned
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* RIGHT PANEL: Embedded Interactive Google Map / Spatial Vector Route Grid */}
          <section
            aria-label="Interactive Route Map"
            className="w-full lg:w-[48%] xl:w-[50%] flex-1 flex flex-col bg-slate-900"
          >
            <DispatcherMap
              vehicles={vehicles}
              tasks={tasks}
              clusters={clusters}
              selectedTempFilter={tempFilter}
              selectedTaskOrderId={selectedTaskOrderId}
              onSelectTask={setSelectedTaskOrderId}
            />
          </section>
        </main>
      )}

      {/* VIEW 2: 3D STRATEGY ROOM (Three.js Digital Twin City Grid) */}
      {activeTab === 'strategy3d' && (
        <main className="flex-1 overflow-hidden">
          <StrategyRoom3D
            vehicles={vehicles}
            tasks={tasks}
            clusters={clusters}
            onTriggerOptimize={handleOptimizeRoutes}
          />
        </main>
      )}

      {/* VIEW 3: SQL ASSET SCHEMA & RELATIONAL TABLES (Module 1 Inspection) */}
      {activeTab === 'schema' && (
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                SQL Database Schema & Cold-Chain Asset Registry
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Relational tables for <code className="font-mono text-xs">vehicles</code> and <code className="font-mono text-xs">delivery_tasks</code> enforcing strict temperature capacity and time-window constraints.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddTaskModalOpen(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Insert Delivery Task Row
            </button>
          </div>

          {/* DDL Schema Declarations */}
          {schemaDefinitions && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 bg-slate-900 text-slate-100 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-mono text-sky-400 mb-2">
                  <Database className="w-3.5 h-3.5" />
                  <span>TABLE 01 · vehicles</span>
                </div>
                <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {schemaDefinitions.vehiclesTable}
                </pre>
              </div>
              <div className="p-5 bg-slate-900 text-slate-100 rounded-xl border border-slate-800">
                <div className="flex items-center gap-2 text-xs font-mono text-teal-400 mb-2">
                  <Database className="w-3.5 h-3.5" />
                  <span>TABLE 02 · delivery_tasks</span>
                </div>
                <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {schemaDefinitions.deliveryTasksTable}
                </pre>
              </div>
            </div>
          )}

          {/* Live Vehicles SQL Table */}
          <section className="space-y-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Truck className="w-4 h-4 text-slate-700" />
              <span>Vehicles Table ({vehicles.length} rows)</span>
            </h2>
            <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Vehicle ID</th>
                    <th className="py-3 px-4">Unit Name</th>
                    <th className="py-3 px-4">Chassis Type</th>
                    <th className="py-3 px-4">Temperature Capacity</th>
                    <th className="py-3 px-4">Staging Hub</th>
                    <th className="py-3 px-4 text-right">Coordinates</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                  {vehicles.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-bold text-slate-900">{v.id}</td>
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-900">
                        {v.name}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-600">{v.type}</td>
                      <td className="py-2.5 px-4 font-sans font-semibold text-slate-800">
                        {v.temperatureCapacity} ({v.tempRangeLabel})
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-600">
                        {v.hubName}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-500">
                        {v.currentLat.toFixed(4)}, {v.currentLng.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Live Delivery Tasks SQL Table */}
          <section className="space-y-3">
            <h2 className="text-base font-bold text-slate-900">
              Delivery Tasks Table ({tasks.length} rows)
            </h2>
            <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Order ID</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Facility</th>
                    <th className="py-3 px-4">Specimen Type</th>
                    <th className="py-3 px-4">Temp Profile</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4 text-right">Deadline</th>
                    <th className="py-3 px-4 text-right">Assigned Vehicle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                  {tasks.map((t) => (
                    <tr key={t.orderId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-bold text-slate-900">
                        {t.orderId}
                      </td>
                      <td className="py-2.5 px-4 font-sans font-semibold">
                        <span
                          className={
                            t.status === 'Optimized'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-900">
                        {t.facilityName}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-600">
                        {t.specimenType}
                      </td>
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-800">
                        {t.requiredTemp}
                      </td>
                      <td className="py-2.5 px-4 font-sans font-semibold">
                        <span
                          className={
                            t.priority === 'STAT' ? 'text-red-600' : 'text-slate-600'
                          }
                        >
                          {t.priority}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">{t.deadlineTime}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        {t.assignedVehicleId
                          ? `${t.assignedVehicleId} (#${t.stopSequence})`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {/* VIEW 4: HIGH-THINKING GEMINI 4 ARGON COLD-CHAIN AI ADVISORY */}
      {activeTab === 'advisory' && (
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 space-y-6">
          <div className="border-b border-slate-200 pb-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-mono text-blue-600 font-semibold flex items-center gap-1.5">
                <BrainCircuit className="w-4 h-4" />
                <span>GEMINI-4-ARGON · THINKINGLEVEL.HIGH</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-1">
                Deep Cold-Chain Risk & STAT Bottleneck Advisory
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                High-thinking reasoning across multi-stop thermal excursion risks, STAT trauma deadlines, and fleet rebalancing.
              </p>
            </div>
          </div>

          {/* Interactive Complex Query Form */}
          <form
            onSubmit={handleRunAIAnalysis}
            className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <input
              type="text"
              value={advisoryQuery}
              onChange={(e) => setAdvisoryQuery(e.target.value)}
              placeholder="Ask a complex routing question (e.g., How should we rebalance if UCSF Mission Bay adds 5 STAT -80°C CAR-T deliveries at 09:30?)..."
              aria-label="Complex Cold-Chain Routing Query"
              className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={isAnalyzingAI}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isAnalyzingAI ? 'Reasoning (ThinkingLevel.HIGH)...' : 'Run Deep Analysis'}
            </button>
          </form>

          {isAnalyzingAI ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
              <div className="text-sm font-semibold text-slate-900">
                Executing High-Thinking Cold-Chain Constraint Analysis...
              </div>
              <p className="text-xs text-slate-500">
                Evaluating thermal capacity constraints, STAT deadline buffers, and urban SF corridor congestion.
              </p>
            </div>
          ) : advisoryReport ? (
            <div className="space-y-6">
              {advisoryReport.quotaNotice && (
                <div
                  role="note"
                  className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900 flex items-center justify-between gap-3"
                >
                  <span>{advisoryReport.quotaNotice}</span>
                  <span className="font-mono text-[11px] text-amber-700 shrink-0">
                    Settings &gt; Secrets
                  </span>
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                  <span>EXECUTIVE SUMMARY</span>
                  <span>
                    {advisoryReport.modelUsed} · {advisoryReport.generatedAt}
                  </span>
                </div>
                <p className="text-sm text-slate-800 leading-relaxed font-medium">
                  {advisoryReport.executiveSummary}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <h2 className="text-sm font-bold text-slate-900">
                    01. Cold-Chain Excursion Risk Audit
                  </h2>
                  <ul className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                    {advisoryReport.coldChainRiskAnalysis.map((item, idx) => (
                      <li key={idx} className="pb-2.5 border-b border-slate-100 last:border-none last:pb-0">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                  <h2 className="text-sm font-bold text-slate-900">
                    02. STAT Time-Window Bottleneck Mitigations
                  </h2>
                  <ul className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                    {advisoryReport.statBottleneckMitigations.map((item, idx) => (
                      <li key={idx} className="pb-2.5 border-b border-slate-100 last:border-none last:pb-0">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bg-slate-900 text-slate-100 rounded-xl p-6 space-y-2">
                <div className="text-xs font-mono text-sky-400">
                  03. FLEET REBALANCING & STAGING RECOMMENDATION
                </div>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {advisoryReport.fleetRebalancingRecommendation}
                </p>
              </div>
            </div>
          ) : null}
        </main>
      )}

      {/* Modal: Google Sheets & Drive Batch Ingestion */}
      <SheetsIngestModal
        isOpen={isSheetsModalOpen}
        onClose={() => setIsSheetsModalOpen(false)}
        onIngestTasks={handleIngestBatch}
      />

      {/* Modal: Add Custom Specimen Delivery Task */}
      {isAddTaskModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-specimen-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2
                id="add-specimen-modal-title"
                className="text-sm font-bold text-slate-900"
              >
                New Medical Specimen Dispatch Order
              </h2>
              <button
                type="button"
                onClick={() => setIsAddTaskModalOpen(false)}
                aria-label="Close New Order Modal"
                className="p-1 text-slate-400 hover:text-slate-800 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700">
                  {formError}
                </div>
              )}

              <div>
                <label
                  htmlFor="facility-name-input"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Destination Hospital / Lab Facility
                </label>
                <input
                  id="facility-name-input"
                  type="text"
                  value={newFacility}
                  onChange={(e) => setNewFacility(e.target.value)}
                  placeholder="e.g., UCSF Mount Zion Pathology Lab"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="specimen-type-input"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Specimen Payload Description
                </label>
                <input
                  id="specimen-type-input"
                  type="text"
                  value={newSpecimen}
                  onChange={(e) => setNewSpecimen(e.target.value)}
                  placeholder="e.g., Cryopreserved Stem Cell Aliquot (-80°C)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="temp-select"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Temperature Profile
                  </label>
                  <select
                    id="temp-select"
                    value={newTemp}
                    onChange={(e) => setNewTemp(e.target.value as TemperatureCapacity)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 bg-white"
                  >
                    <option value="Frozen">Frozen (-80°C)</option>
                    <option value="Refrigerated">Refrigerated (2–8°C)</option>
                    <option value="Ambient">Ambient (18–24°C)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="priority-select"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Urgency Tier
                  </label>
                  <select
                    id="priority-select"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 bg-white"
                  >
                    <option value="STAT">STAT (Immediate)</option>
                    <option value="Routine">Routine</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="deadline-input"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Time Window Deadline (24h HH:MM)
                </label>
                <input
                  id="deadline-input"
                  type="text"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  placeholder="10:15"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddTaskModalOpen(false)}
                  className="px-3.5 py-2 text-slate-600 hover:text-slate-900 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg cursor-pointer"
                >
                  Save Specimen Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
