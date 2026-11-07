export type TemperatureCapacity = 'Ambient' | 'Refrigerated' | 'Frozen';
export type TaskStatus = 'Pending' | 'Optimized';
export type TaskPriority = 'STAT' | 'Routine';

export interface Vehicle {
  id: string;
  name: string;
  type: string;
  temperatureCapacity: TemperatureCapacity;
  tempRangeLabel: string;
  currentLat: number;
  currentLng: number;
  hubName: string;
  routeColor: string;
  maxStops: number;
  driverName: string;
}

export interface DeliveryTask {
  orderId: string;
  status: TaskStatus;
  facilityName: string;
  address: string;
  lat: number;
  lng: number;
  specimenType: string;
  requiredTemp: TemperatureCapacity;
  priority: TaskPriority;
  deadlineTime: string; // HH:MM (24h)
  assignedVehicleId: string | null;
  stopSequence: number | null;
  estimatedArrival: string | null;
  distanceKm: number | null;
  batchSource?: string;
}

export interface OptimizedRouteCluster {
  vehicleId: string;
  vehicleName: string;
  vehicleType: string;
  temperatureCapacity: TemperatureCapacity;
  tempRangeLabel: string;
  routeColor: string;
  origin: {
    lat: number;
    lng: number;
    label: string;
  };
  stops: DeliveryTask[];
  totalDistanceKm: number;
  estimatedDurationMin: number;
  statCount: number;
  routineCount: number;
  pathCoordinates: Array<{ lat: number; lng: number }>;
}

export interface OptimizationResult {
  tasks: DeliveryTask[];
  clusters: OptimizedRouteCluster[];
  metrics: {
    totalTasksOptimized: number;
    statTasksCount: number;
    totalFleetDistanceKm: number;
    estimatedSavedKm: number;
    coldChainMatchRate: number;
    statWindowCompliance: number;
    solverRuntimeMs: number;
  };
}

export interface AIAdvisoryReport {
  executiveSummary: string;
  coldChainRiskAnalysis: string[];
  statBottleneckMitigations: string[];
  fleetRebalancingRecommendation: string;
  modelUsed: string;
  generatedAt: string;
  quotaNotice?: string;
}
