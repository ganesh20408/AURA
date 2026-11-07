import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHaversineKm,
  formatMinutesToTime,
  parseTimeToMinutes,
  runHybridRouteOptimization,
} from './optimizer';
import { DeliveryTask, Vehicle } from '../types/logistics';

const mockVehicles: Vehicle[] = [
  {
    id: 'VEH-CRYO-01',
    name: 'CryoGuard Alpha',
    type: 'LN2 Cryo-Van',
    temperatureCapacity: 'Frozen',
    tempRangeLabel: '-80°C to -20°C',
    currentLat: 37.7749,
    currentLng: -122.4194,
    hubName: 'UCSF Central Bio-Depot',
    routeColor: '#0284c7',
    maxStops: 12,
    driverName: 'Elena Vance',
  },
  {
    id: 'VEH-REEF-02',
    name: 'ColdChain Sprinter',
    type: 'Active Reefer Van',
    temperatureCapacity: 'Refrigerated',
    tempRangeLabel: '2°C to 8°C',
    currentLat: 37.7651,
    currentLng: -122.4581,
    hubName: 'Parnassus Medical Hub',
    routeColor: '#0d9488',
    maxStops: 15,
    driverName: 'Marcus Sterling',
  },
  {
    id: 'VEH-AMB-03',
    name: 'StatRunner Sedan',
    type: 'Thermal-Insulated EV',
    temperatureCapacity: 'Ambient',
    tempRangeLabel: '15°C to 25°C',
    currentLat: 37.7895,
    currentLng: -122.4014,
    hubName: 'Downtown Clinical Lab',
    routeColor: '#4f46e5',
    maxStops: 18,
    driverName: 'Devon Brooks',
  },
];

const mockTasks: DeliveryTask[] = [
  {
    orderId: 'ORD-901',
    status: 'Pending',
    facilityName: 'Mission Bay Oncology Lab',
    address: '1600 Owens St, San Francisco, CA',
    lat: 37.7678,
    lng: -122.3918,
    specimenType: 'Cryopreserved CAR-T Cells',
    requiredTemp: 'Frozen',
    priority: 'Routine',
    deadlineTime: '13:30',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
  {
    orderId: 'ORD-902',
    status: 'Pending',
    facilityName: 'SF General Trauma Center',
    address: '1001 Potrero Ave, San Francisco, CA',
    lat: 37.7555,
    lng: -122.4046,
    specimenType: 'Flash-Frozen Intraoperative Biopsy',
    requiredTemp: 'Frozen',
    priority: 'STAT',
    deadlineTime: '09:45',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
  {
    orderId: 'ORD-903',
    status: 'Pending',
    facilityName: 'CPMC Van Ness Campus',
    address: '1101 Van Ness Ave, San Francisco, CA',
    lat: 37.7858,
    lng: -122.4214,
    specimenType: 'Crossmatched Type-O Leukoreduced RBC',
    requiredTemp: 'Refrigerated',
    priority: 'STAT',
    deadlineTime: '09:30',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
  {
    orderId: 'ORD-904',
    status: 'Pending',
    facilityName: 'St. Mary Medical Center',
    address: '450 Stanyan St, San Francisco, CA',
    lat: 37.7741,
    lng: -122.4547,
    specimenType: 'Formalin Fixed Tissue Cassette',
    requiredTemp: 'Ambient',
    priority: 'Routine',
    deadlineTime: '15:00',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
];

test('Haversine distance and time helper functions work accurately', () => {
  const dist = calculateHaversineKm(37.7749, -122.4194, 37.7555, -122.4046);
  assert.ok(dist > 2 && dist < 6, `Expected urban SF distance between 2 and 6 km, got ${dist}`);
  assert.equal(parseTimeToMinutes('09:45'), 585);
  assert.equal(formatMinutesToTime(585), '09:45');
});

test('Hybrid solver enforces strict temperature profile matching (Frozen only on Frozen trucks)', () => {
  const result = runHybridRouteOptimization(mockVehicles, mockTasks);
  assert.equal(result.tasks.length, 4);

  for (const task of result.tasks) {
    assert.equal(task.status, 'Optimized');
    assert.ok(task.assignedVehicleId, 'Every task must have an assignedVehicleId');
    const vehicle = mockVehicles.find((v) => v.id === task.assignedVehicleId);
    assert.ok(vehicle, 'Assigned vehicle must exist');
    assert.equal(
      vehicle.temperatureCapacity,
      task.requiredTemp,
      `Task ${task.orderId} (${task.requiredTemp}) was routed to ${vehicle.id} (${vehicle.temperatureCapacity})`
    );
  }
});

test('Hybrid solver prioritizes STAT tasks before Routine tasks on the same vehicle', () => {
  const result = runHybridRouteOptimization(mockVehicles, mockTasks);
  const cryoCluster = result.clusters.find((c) => c.vehicleId === 'VEH-CRYO-01');
  assert.ok(cryoCluster, 'Cryo vehicle cluster must exist');
  assert.equal(cryoCluster.stops.length, 2);

  // ORD-902 is STAT Frozen, ORD-901 is Routine Frozen
  assert.equal(cryoCluster.stops[0].orderId, 'ORD-902');
  assert.equal(cryoCluster.stops[0].priority, 'STAT');
  assert.equal(cryoCluster.stops[0].stopSequence, 1);

  assert.equal(cryoCluster.stops[1].orderId, 'ORD-901');
  assert.equal(cryoCluster.stops[1].priority, 'Routine');
  assert.equal(cryoCluster.stops[1].stopSequence, 2);
});
