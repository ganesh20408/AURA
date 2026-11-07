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
    id: 'TN-01-CRYO-101',
    name: 'Tamil Nadu CryoVault Express 01',
    type: 'LN2 Cryo-Van',
    temperatureCapacity: 'Frozen',
    tempRangeLabel: '-80°C to -20°C',
    currentLat: 13.0827,
    currentLng: 80.2707,
    hubName: 'Chennai Central Medical Hub (Park Town)',
    routeColor: '#0284c7',
    maxStops: 12,
    driverName: 'Senthil Kumar',
    operatingZone: 'Chennai Metro & North TN',
    maxRadiusKm: 45,
  },
  {
    id: 'TN-02-REEF-204',
    name: 'Tamil Nadu MedShield Reefer 04',
    type: 'Active Reefer Van',
    temperatureCapacity: 'Refrigerated',
    tempRangeLabel: '2°C to 8°C',
    currentLat: 13.0450,
    currentLng: 80.2450,
    hubName: 'TNMSC Central Warehouse (Nandanam)',
    routeColor: '#0d9488',
    maxStops: 15,
    driverName: 'Anitha Ramesh',
    operatingZone: 'Chennai & Kanchipuram Corridor',
    maxRadiusKm: 50,
  },
  {
    id: 'TN-03-AMB-309',
    name: 'Tamil Nadu PharmaPulse EV 09',
    type: 'Thermal-Insulated EV',
    temperatureCapacity: 'Ambient',
    tempRangeLabel: '15°C to 25°C',
    currentLat: 13.0604,
    currentLng: 80.2505,
    hubName: 'Apollo Greams Dispatch Hub',
    routeColor: '#4f46e5',
    maxStops: 18,
    driverName: 'Karthik Subramanian',
    operatingZone: 'Chennai Central Core',
    maxRadiusKm: 35,
  },
  {
    id: 'TN-04-REEF-CBE',
    name: 'Kongu Pharma Reefer Express',
    type: 'Active Reefer Van',
    temperatureCapacity: 'Refrigerated',
    tempRangeLabel: '2°C to 8°C',
    currentLat: 11.0016,
    currentLng: 76.9674,
    hubName: 'TNMSC Regional Drug Hub (Coimbatore)',
    routeColor: '#10b981',
    maxStops: 12,
    driverName: 'Murugan Palanisamy',
    operatingZone: 'Western TN (Coimbatore)',
    maxRadiusKm: 90,
  },
];

const mockTasks: DeliveryTask[] = [
  {
    orderId: 'ORD-TN-901',
    status: 'Pending',
    facilityName: 'Cancer Institute (WIA) Adyar',
    address: 'Sardar Patel Rd, Adyar, Chennai, Tamil Nadu 600020',
    lat: 13.0076,
    lng: 80.2443,
    specimenType: 'Cryopreserved CAR-T Cells & Oncology Biopsies',
    requiredTemp: 'Frozen',
    priority: 'Routine',
    deadlineTime: '13:30',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
  {
    orderId: 'ORD-TN-902',
    status: 'Pending',
    facilityName: 'Rajiv Gandhi Government General Hospital (RGGGH)',
    address: 'EVR Periyar Salai, Park Town, Chennai, Tamil Nadu 600003',
    lat: 13.0818,
    lng: 80.2774,
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
    orderId: 'ORD-TN-903',
    status: 'Pending',
    facilityName: 'Government Stanley Medical College Hospital',
    address: 'Old Jail Rd, Royapuram, Chennai, Tamil Nadu 600001',
    lat: 13.1077,
    lng: 80.2872,
    specimenType: 'Crossmatched Type-O PRBC Blood Units',
    requiredTemp: 'Refrigerated',
    priority: 'STAT',
    deadlineTime: '09:30',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
  {
    orderId: 'ORD-TN-904',
    status: 'Pending',
    facilityName: 'Government Kilpauk Medical College Hospital',
    address: '822 Poonamallee High Rd, Kilpauk, Chennai, Tamil Nadu 600010',
    lat: 13.0784,
    lng: 80.2428,
    specimenType: 'Silver Sulfadiazine Burn Ointments',
    requiredTemp: 'Ambient',
    priority: 'Routine',
    deadlineTime: '15:00',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
  {
    orderId: 'ORD-CBE-905',
    status: 'Pending',
    facilityName: 'Coimbatore Medical College Hospital (CMCH)',
    address: 'Trichy Rd, Gopalapuram, Coimbatore, Tamil Nadu 641018',
    lat: 11.0016,
    lng: 76.9674,
    specimenType: 'Cold-Chain Insulin Vials (2-8°C)',
    requiredTemp: 'Refrigerated',
    priority: 'Routine',
    deadlineTime: '14:00',
    assignedVehicleId: null,
    stopSequence: null,
    estimatedArrival: null,
    distanceKm: null,
  },
];

test('Haversine distance and time helper functions work accurately', () => {
  // Distance between RGGGH Park Town and Apollo Greams Road in Chennai (~4 to 6 km)
  const dist = calculateHaversineKm(13.0818, 80.2774, 13.0604, 80.2505);
  assert.ok(dist > 3 && dist < 7, `Expected Chennai urban distance between 3 and 7 km, got ${dist}`);
  assert.equal(parseTimeToMinutes('09:45'), 585);
  assert.equal(formatMinutesToTime(585), '09:45');
});

test('Hybrid solver enforces strict temperature profile matching (Frozen only on Frozen trucks)', () => {
  const result = runHybridRouteOptimization(mockVehicles, mockTasks);
  assert.equal(result.tasks.length, 5);

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
  const cryoCluster = result.clusters.find((c) => c.vehicleId === 'TN-01-CRYO-101');
  assert.ok(cryoCluster, 'Cryo vehicle cluster must exist');
  assert.equal(cryoCluster.stops.length, 2);

  // ORD-TN-902 is STAT Frozen, ORD-TN-901 is Routine Frozen
  assert.equal(cryoCluster.stops[0].orderId, 'ORD-TN-902');
  assert.equal(cryoCluster.stops[0].priority, 'STAT');
  assert.equal(cryoCluster.stops[0].stopSequence, 1);

  assert.equal(cryoCluster.stops[1].orderId, 'ORD-TN-901');
  assert.equal(cryoCluster.stops[1].priority, 'Routine');
  assert.equal(cryoCluster.stops[1].stopSequence, 2);
});

test('Hybrid solver enforces operational territory geofencing (Coimbatore order routed to Western TN van, not Chennai)', () => {
  const result = runHybridRouteOptimization(mockVehicles, mockTasks);
  const cbeTask = result.tasks.find((t) => t.orderId === 'ORD-CBE-905');
  assert.ok(cbeTask, 'Coimbatore task must be in results');
  
  // Both TN-02 (Chennai) and TN-04 (Coimbatore) are Refrigerated,
  // but ORD-CBE-905 is in Coimbatore (~500 km from Chennai), so it must be assigned to TN-04-REEF-CBE!
  assert.equal(
    cbeTask.assignedVehicleId,
    'TN-04-REEF-CBE',
    `Expected Coimbatore order to be assigned to TN-04-REEF-CBE, but got ${cbeTask.assignedVehicleId}`
  );

  const chennaiReefCluster = result.clusters.find((c) => c.vehicleId === 'TN-02-REEF-204');
  assert.ok(chennaiReefCluster, 'Chennai reef cluster must exist');
  assert.equal(chennaiReefCluster.stops.length, 1);
  assert.equal(chennaiReefCluster.stops[0].orderId, 'ORD-TN-903');
});
