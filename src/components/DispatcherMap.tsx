import React, { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  DeliveryTask,
  OptimizedRouteCluster,
  TemperatureCapacity,
  Vehicle,
} from '../types/logistics';
import { MapPin, Navigation, Layers, Compass, Truck } from 'lucide-react';

interface DispatcherMapProps {
  vehicles: Vehicle[];
  tasks: DeliveryTask[];
  clusters: OptimizedRouteCluster[];
  selectedTempFilter: TemperatureCapacity | 'All';
  selectedTaskOrderId: string | null;
  onSelectTask: (orderId: string | null) => void;
}

const SF_CENTER = { lat: 37.7725, lng: -122.4315 };

/**
 * Child component inside <GoogleMap> that uses the modern Routes API (`useMapsLibrary('routes')`)
 * and renders multi-stop polylines on the Google Map instance.
 */
interface MapPolylineInstance {
  setMap: (map: any) => void;
  setOptions: (options: Record<string, any>) => void;
}

function GoogleMapRoutePolylines({
  clusters,
  selectedTempFilter,
}: {
  clusters: OptimizedRouteCluster[];
  selectedTempFilter: TemperatureCapacity | 'All';
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const mapsLib = useMapsLibrary('maps');
  const polylinesRef = useRef<MapPolylineInstance[]>([]);

  useEffect(() => {
    if (!map || !mapsLib) return;

    // Clear existing polylines
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const visibleClusters = clusters.filter(
      (c) =>
        c.stops.length > 0 &&
        (selectedTempFilter === 'All' || c.temperatureCapacity === selectedTempFilter)
    );

    visibleClusters.forEach((cluster) => {
      // Draw immediate high-contrast multi-stop polyline connecting hub -> stops
      const fallbackPolyline = new mapsLib.Polyline({
        path: cluster.pathCoordinates,
        geodesic: true,
        strokeColor: cluster.routeColor,
        strokeOpacity: 0.92,
        strokeWeight: 4,
        map,
      });
      polylinesRef.current.push(fallbackPolyline);

      // Also attempt modern Route.computeRoutes when routesLib is ready for road-snapped geometry
      if (routesLib && (routesLib as any).Route?.computeRoutes && cluster.stops.length >= 1) {
        const lastStop = cluster.stops[cluster.stops.length - 1];
        const intermediates = cluster.stops.slice(0, -1).map((s) => ({
          location: { lat: s.lat, lng: s.lng },
        }));

        const request: any = {
          origin: { lat: cluster.origin.lat, lng: cluster.origin.lng },
          destination: { lat: lastStop.lat, lng: lastStop.lng },
          intermediates: intermediates.length > 0 ? intermediates : undefined,
          travelMode: 'DRIVING',
          fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
        };

        (routesLib as any).Route.computeRoutes(request)
          .then(({ routes }: { routes: any[] }) => {
            if (routes && routes[0] && typeof routes[0].createPolylines === 'function') {
              const roadPolylines: MapPolylineInstance[] = routes[0].createPolylines();
              roadPolylines.forEach((rp) => {
                rp.setOptions({
                  strokeColor: cluster.routeColor,
                  strokeWeight: 5,
                  strokeOpacity: 0.95,
                });
                rp.setMap(map);
                polylinesRef.current.push(rp);
              });
              // Hide straight-line connector once road-snapped polyline renders
              fallbackPolyline.setMap(null);
            }
          })
          .catch((err: any) => {
            const msg = String(err?.message || err || '');
            if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT') || msg.includes('429')) {
              window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
            }
          });
      }
    });

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, mapsLib, routesLib, clusters, selectedTempFilter]);

  return null;
}

export const DispatcherMap: React.FC<DispatcherMapProps> = ({
  vehicles,
  tasks,
  clusters,
  selectedTempFilter,
  selectedTaskOrderId,
  onSelectTask,
}) => {
  const rawApiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || '';
  const hasConfiguredGoogleMapsKey =
    Boolean(rawApiKey) &&
    rawApiKey !== 'MY_GOOGLE_MAPS_API_KEY' &&
    rawApiKey !== 'YOUR_API_KEY';

  const [mapMode, setMapMode] = useState<'google' | 'vector'>(
    hasConfiguredGoogleMapsKey ? 'google' : 'vector'
  );
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const visibleTasks = tasks.filter(
    (t) => selectedTempFilter === 'All' || t.requiredTemp === selectedTempFilter
  );
  const visibleVehicles = vehicles.filter(
    (v) => selectedTempFilter === 'All' || v.temperatureCapacity === selectedTempFilter
  );
  const visibleClusters = clusters.filter(
    (c) =>
      c.stops.length > 0 &&
      (selectedTempFilter === 'All' || c.temperatureCapacity === selectedTempFilter)
  );

  const activeTask = tasks.find((t) => t.orderId === selectedTaskOrderId) || null;
  const activeVehicle = vehicles.find((v) => v.id === selectedVehicleId) || null;

  // Coordinate projection helper for Vector Spatial Map (San Francisco bounds)
  const projectCoord = (lat: number, lng: number) => {
    const minLat = 37.736;
    const maxLat = 37.808;
    const minLng = -122.522;
    const maxLng = -122.362;
    const x = ((lng - minLng) / (maxLng - minLng)) * 900;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 620;
    return {
      x: Math.max(48, Math.min(840, x)),
      y: Math.max(44, Math.min(576, y)),
    };
  };

  const tempStrokeColor: Record<TemperatureCapacity, string> = {
    Frozen: '#0284c7',
    Refrigerated: '#0d9488',
    Ambient: '#4f46e5',
  };

  return (
    <div className="relative w-full h-full min-h-[540px] bg-slate-900 overflow-hidden flex flex-col">
      {/* Top Map Sub-Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-slate-200 z-10 shrink-0">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-white tracking-tight flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            San Francisco Medical Corridor
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="font-mono text-slate-400 tabular-nums">
            37.7749° N, 122.4194° W
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="text-slate-300 tabular-nums">
            {visibleVehicles.length} Fleet Units
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="text-slate-300 tabular-nums">
            {visibleTasks.length} Delivery Stops
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Map rendering layer"
            className="flex items-center bg-slate-800 p-0.5 rounded-md border border-slate-700"
          >
            <button
              type="button"
              onClick={() => setMapMode('vector')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                mapMode === 'vector'
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Spatial Route Grid
            </button>
            <button
              type="button"
              onClick={() => setMapMode('google')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                mapMode === 'google'
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Google Maps SDK
            </button>
          </div>
        </div>
      </div>

      {/* Main Map Surface */}
      <div className="relative flex-1 w-full h-full">
        {mapMode === 'google' && hasConfiguredGoogleMapsKey ? (
          <APIProvider apiKey={rawApiKey} libraries={['marker', 'routes', 'maps']}>
            <div className="w-full h-full" style={{ minHeight: '500px', height: '100%' }}>
              <GoogleMap
                defaultCenter={SF_CENTER}
                defaultZoom={12.5}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                disableDefaultUI={false}
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                style={{ width: '100%', height: '100%' }}
              >
                <GoogleMapRoutePolylines
                  clusters={clusters}
                  selectedTempFilter={selectedTempFilter}
                />

                {/* Vehicle Markers */}
                {visibleVehicles.map((vehicle) => (
                  <AdvancedMarker
                    key={vehicle.id}
                    position={{ lat: vehicle.currentLat, lng: vehicle.currentLng }}
                    title={`${vehicle.name} (${vehicle.temperatureCapacity})`}
                    onClick={() => {
                      setSelectedVehicleId(vehicle.id);
                      onSelectTask(null);
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded shadow-md border border-white text-white text-xs font-semibold"
                      style={{ backgroundColor: vehicle.routeColor }}
                    >
                      <Truck className="w-3.5 h-3.5" />
                      <span>{vehicle.id}</span>
                    </div>
                  </AdvancedMarker>
                ))}

                {/* Delivery Stop Markers */}
                {visibleTasks.map((task) => {
                  const isSelected = task.orderId === selectedTaskOrderId;
                  const pinColor = tempStrokeColor[task.requiredTemp];
                  return (
                    <AdvancedMarker
                      key={task.orderId}
                      position={{ lat: task.lat, lng: task.lng }}
                      title={`${task.orderId}: ${task.facilityName}`}
                      onClick={() => {
                        onSelectTask(task.orderId);
                        setSelectedVehicleId(null);
                      }}
                    >
                      <div
                        className={`flex items-center justify-center w-7 h-7 rounded-full border-2 border-white shadow-md text-white font-mono text-xs font-bold transition-transform ${
                          isSelected ? 'scale-125 ring-2 ring-amber-400' : ''
                        }`}
                        style={{ backgroundColor: pinColor }}
                      >
                        {task.stopSequence ?? (task.priority === 'STAT' ? '!' : '•')}
                      </div>
                    </AdvancedMarker>
                  );
                })}

                {activeTask && (
                  <InfoWindow
                    position={{ lat: activeTask.lat, lng: activeTask.lng }}
                    onCloseClick={() => onSelectTask(null)}
                  >
                    <div className="p-1 text-slate-900 max-w-[240px]">
                      <div className="text-xs font-mono font-semibold text-slate-500">
                        {activeTask.orderId} · {activeTask.priority} · {activeTask.requiredTemp}
                      </div>
                      <div className="text-sm font-bold mt-0.5">{activeTask.facilityName}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{activeTask.specimenType}</div>
                      <div className="text-xs font-mono text-slate-700 mt-1">
                        Deadline: {activeTask.deadlineTime}
                        {activeTask.estimatedArrival
                          ? ` · ETA: ${activeTask.estimatedArrival}`
                          : ''}
                      </div>
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            </div>
          </APIProvider>
        ) : (
          /* High-Precision Interactive Spatial Route Grid (Also used when Google Maps API Key is not yet set in .env) */
          <div
            data-testid="dispatcher-spatial-map"
            className="relative w-full h-full bg-[#0b1324] select-none overflow-hidden"
          >
            {mapMode === 'google' && !hasConfiguredGoogleMapsKey && (
              <div className="absolute top-3 left-4 right-4 z-20 bg-slate-900/95 border border-slate-700 text-slate-200 px-3.5 py-2 rounded-md text-xs flex items-center justify-between">
                <span>
                  Google Maps SDK Ready (<code className="font-mono text-sky-400">@vis.gl/react-google-maps</code> + <code className="font-mono text-sky-400">Route.computeRoutes</code>). Showing live San Francisco Spatial Vector Grid until <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> is populated.
                </span>
                <button
                  type="button"
                  onClick={() => setMapMode('vector')}
                  className="text-sky-400 hover:text-sky-300 font-medium underline ml-3 whitespace-nowrap shrink-0"
                >
                  Dismiss Notice
                </button>
              </div>
            )}

            <svg
              viewBox="0 0 900 620"
              className="w-full h-full object-cover"
              aria-label="San Francisco Medical Courier Route Map"
            >
              <defs>
                <pattern
                  id="sf-grid-minor"
                  width="30"
                  height="30"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 30 0 L 0 0 0 30"
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.07)"
                    strokeWidth="1"
                  />
                </pattern>
                <pattern
                  id="sf-grid-major"
                  width="120"
                  height="120"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="120" height="120" fill="url(#sf-grid-minor)" />
                  <path
                    d="M 120 0 L 0 0 0 120"
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.14)"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>

              {/* Bay Water & SF Peninsula Silhouette */}
              <rect width="900" height="620" fill="#070d19" />
              <path
                d="M 45,620 L 40,210 Q 55,115 140,85 L 360,55 Q 520,40 645,95 L 775,215 Q 825,360 810,620 Z"
                fill="#0f172a"
                stroke="#1e293b"
                strokeWidth="2"
              />
              <rect width="900" height="620" fill="url(#sf-grid-major)" />

              {/* Major Arterial Medical Corridors (Geary, Market, Van Ness, I-280/101) */}
              <g stroke="rgba(100, 116, 139, 0.28)" strokeWidth="2.5" fill="none">
                {/* Market St diagonal */}
                <path d="M 340,420 L 710,145" />
                {/* Van Ness Ave N-S */}
                <path d="M 560,65 L 560,560" />
                {/* Geary Blvd E-W */}
                <path d="M 85,225 L 650,225" />
                {/* Potrero / 101 Corridor */}
                <path d="M 650,225 L 690,580" />
                {/* 3rd St / Mission Bay */}
                <path d="M 745,175 L 765,560" />
                {/* Sunset / Stanyan */}
                <path d="M 355,140 L 355,560" />
              </g>

              {/* Neighborhood Reference Labels */}
              <g
                fill="rgba(148, 163, 184, 0.38)"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
                letterSpacing="1.5"
              >
                <text x="95" y="195">RICHMOND / VA</text>
                <text x="365" y="295">PARNASSUS HEIGHTS</text>
                <text x="575" y="195">VAN NESS CORRIDOR</text>
                <text x="720" y="265">MISSION BAY BIO-HUB</text>
                <text x="580" y="425">POTRERO / ZSFG</text>
              </g>

              {/* Multi-Stop Optimized Route Polylines */}
              {visibleClusters.map((cluster) => {
                if (cluster.pathCoordinates.length < 2) return null;
                const pts = cluster.pathCoordinates.map((c) => projectCoord(c.lat, c.lng));
                const dPath = pts
                  .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                  .join(' ');

                return (
                  <g key={cluster.vehicleId}>
                    {/* Outer subtle casing */}
                    <path
                      d={dPath}
                      fill="none"
                      stroke={cluster.routeColor}
                      strokeWidth="7"
                      strokeOpacity="0.22"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Core route trajectory line */}
                    <path
                      d={dPath}
                      fill="none"
                      stroke={cluster.routeColor}
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Direction arrows along each leg */}
                    {pts.slice(0, -1).map((p1, legIdx) => {
                      const p2 = pts[legIdx + 1];
                      const midX = (p1.x + p2.x) / 2;
                      const midY = (p1.y + p2.y) / 2;
                      return (
                        <circle
                          key={`${cluster.vehicleId}-leg-${legIdx}`}
                          cx={midX}
                          cy={midY}
                          r="3.5"
                          fill={cluster.routeColor}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* Vehicle Hub Nodes */}
              {visibleVehicles.map((vehicle) => {
                const pos = projectCoord(vehicle.currentLat, vehicle.currentLng);
                const isVehSelected = selectedVehicleId === vehicle.id;
                return (
                  <g
                    key={vehicle.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedVehicleId(vehicle.id);
                      onSelectTask(null);
                    }}
                  >
                    <rect
                      x="-54"
                      y="-28"
                      width="108"
                      height="22"
                      rx="4"
                      fill="#0f172a"
                      stroke={vehicle.routeColor}
                      strokeWidth={isVehSelected ? '2' : '1.2'}
                    />
                    <text
                      x="0"
                      y="-14"
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {vehicle.id}
                    </text>
                    <circle
                      cx="0"
                      cy="0"
                      r="8"
                      fill={vehicle.routeColor}
                      stroke="#ffffff"
                      strokeWidth="2"
                    />
                  </g>
                );
              })}

              {/* Delivery Task Pins */}
              {visibleTasks.map((task) => {
                const pos = projectCoord(task.lat, task.lng);
                const isSelected = task.orderId === selectedTaskOrderId;
                const color = tempStrokeColor[task.requiredTemp];
                const badgeText =
                  task.stopSequence !== null
                    ? String(task.stopSequence)
                    : task.priority === 'STAT'
                    ? '!'
                    : '•';

                return (
                  <g
                    key={task.orderId}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className="cursor-pointer"
                    onClick={() => {
                      onSelectTask(task.orderId);
                      setSelectedVehicleId(null);
                    }}
                  >
                    {isSelected && (
                      <circle
                        cx="0"
                        cy="0"
                        r="18"
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth="2"
                      />
                    )}
                    <circle
                      cx="0"
                      cy="0"
                      r={task.priority === 'STAT' ? '12' : '10'}
                      fill={color}
                      stroke={task.priority === 'STAT' ? '#fef08a' : '#ffffff'}
                      strokeWidth={isSelected ? '3' : '2'}
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="10"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {badgeText}
                    </text>
                    <text
                      x={pos.x > 690 ? -15 : 15}
                      y="4"
                      textAnchor={pos.x > 690 ? 'end' : 'start'}
                      fill="#e2e8f0"
                      fontSize="10.5"
                      fontWeight="500"
                      fontFamily="Plus Jakarta Sans, sans-serif"
                    >
                      {task.facilityName.split(' ').slice(0, 3).join(' ')}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Selected Task or Vehicle Inspector Overlay Card */}
            {(activeTask || activeVehicle) && (
              <div className="absolute bottom-14 left-4 z-20 bg-slate-900/95 border border-slate-700 rounded-lg p-3.5 text-slate-100 shadow-xl max-w-sm">
                {activeTask && (
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-xs text-sky-400 font-semibold">
                        {activeTask.orderId} · {activeTask.priority} · {activeTask.requiredTemp}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectTask(null)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Close
                      </button>
                    </div>
                    <h4 className="text-sm font-semibold text-white mt-1">
                      {activeTask.facilityName}
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5">{activeTask.specimenType}</p>
                    <div className="mt-2 pt-2 border-t border-slate-800 flex items-center gap-3 text-xs font-mono text-slate-300 tabular-nums">
                      <span>Deadline: {activeTask.deadlineTime}</span>
                      <span>·</span>
                      <span>
                        {activeTask.status === 'Optimized'
                          ? `Stop #${activeTask.stopSequence} (${activeTask.assignedVehicleId}) · ETA ${activeTask.estimatedArrival}`
                          : 'Status: Pending Optimization'}
                      </span>
                    </div>
                  </div>
                )}

                {activeVehicle && (
                  <div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-xs text-teal-400 font-semibold">
                        {activeVehicle.id} · {activeVehicle.temperatureCapacity} ({activeVehicle.tempRangeLabel})
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedVehicleId(null)}
                        className="text-xs text-slate-400 hover:text-white"
                      >
                        Close
                      </button>
                    </div>
                    <h4 className="text-sm font-semibold text-white mt-1">
                      {activeVehicle.name} — {activeVehicle.type}
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Hub: {activeVehicle.hubName} · Specialist: {activeVehicle.driverName}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Map Legend Bar */}
        <div className="absolute bottom-3 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 bg-slate-900/95 border border-slate-800 px-3.5 py-2 rounded-md text-xs text-slate-300">
          <div className="flex items-center gap-4">
            <span className="font-medium text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              Cold-Chain Route Legend:
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1 bg-sky-500 inline-block rounded-xs" />
              Frozen (-80°C LN2)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1 bg-teal-500 inline-block rounded-xs" />
              Refrigerated (2°C–8°C)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-1 bg-indigo-500 inline-block rounded-xs" />
              Ambient (18°C–24°C)
            </span>
          </div>
          <div className="font-mono text-slate-400 tabular-nums flex items-center gap-1.5">
            <Navigation className="w-3 h-3 text-sky-400" />
            {clusters.some((c) => c.stops.length > 0)
              ? `${clusters.reduce((acc, c) => acc + c.stops.length, 0)} stops routed across ${
                  clusters.filter((c) => c.stops.length > 0).length
                } thermal corridors`
              : 'Click "Optimize Routes" to compute multi-stop trajectories'}
          </div>
        </div>
      </div>
    </div>
  );
};
