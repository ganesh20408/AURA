import React, { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Marker,
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
import {
  Compass,
  Truck,
  Layers,
  Navigation,
  Key,
  Locate,
  MapPin,
  ExternalLink,
  Plus,
  Check,
  RotateCcw,
} from 'lucide-react';
import {
  LocationAutocompleteInput,
  SelectedLocationData,
} from './LocationAutocompleteInput';

const InteractiveLeafletMap = React.lazy(() =>
  import('./InteractiveLeafletMap').then((mod) => ({ default: mod.InteractiveLeafletMap }))
);

interface DispatcherMapProps {
  vehicles: Vehicle[];
  tasks: DeliveryTask[];
  clusters: OptimizedRouteCluster[];
  selectedTempFilter: TemperatureCapacity | 'All';
  selectedCourierFilter?: string;
  selectedTaskOrderId: string | null;
  onSelectTask: (orderId: string | null) => void;
  userLocation?: SelectedLocationData | null;
  onSetUserLocation?: (location: SelectedLocationData) => void;
  onRequestCreateTaskAtLocation?: (location: SelectedLocationData) => void;
}

const TN_CENTER = { lat: 13.0827, lng: 80.2707 };

/**
 * Child component inside <GoogleMap> that centers map on selected task or user location.
 */
function GoogleMapCenterController({
  userLocation,
  selectedTask,
}: {
  userLocation: SelectedLocationData | null;
  selectedTask: DeliveryTask | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (selectedTask) {
      map.panTo({ lat: selectedTask.lat, lng: selectedTask.lng });
      map.setZoom(14);
    } else if (userLocation) {
      map.panTo({ lat: userLocation.lat, lng: userLocation.lng });
      map.setZoom(14);
    }
  }, [map, userLocation, selectedTask]);

  return null;
}

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

      // Attempt modern Route.computeRoutes when routesLib is ready for road-snapped geometry
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
            if (
              msg.includes('RESOURCE_EXHAUSTED') ||
              msg.includes('OVER_QUERY_LIMIT') ||
              msg.includes('429')
            ) {
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
  selectedCourierFilter,
  selectedTaskOrderId,
  onSelectTask,
  userLocation = null,
  onSetUserLocation,
  onRequestCreateTaskAtLocation,
}) => {
  // Read stored or env Google Maps API Key
  const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || '';
  const [apiKey, setApiKey] = useState<string>(() => {
    const saved = localStorage.getItem('google_maps_api_key');
    if (saved && saved.trim()) return saved.trim();
    if (envKey && envKey !== 'MY_GOOGLE_MAPS_API_KEY' && envKey !== 'YOUR_API_KEY') {
      return envKey;
    }
    return '';
  });

  const [inputKey, setInputKey] = useState<string>('');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const hasConfiguredGoogleMapsKey = Boolean(apiKey && apiKey.trim().length > 5);

  // Map Mode: default to 'google' if key configured, otherwise 'interactive' (Leaflet with real tiles)
  const [mapMode, setMapMode] = useState<'google' | 'interactive' | 'vector'>(() => {
    return hasConfiguredGoogleMapsKey ? 'google' : 'interactive';
  });

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [isUserLocationInfoOpen, setIsUserLocationInfoOpen] = useState(false);
  const [locationSearchText, setLocationSearchText] = useState('');

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

  const tempStrokeColor: Record<TemperatureCapacity, string> = {
    Frozen: '#0284c7',
    Refrigerated: '#0d9488',
    Ambient: '#4f46e5',
  };

  const handleSaveApiKey = (newKey: string) => {
    const trimmed = newKey.trim();
    localStorage.setItem('google_maps_api_key', trimmed);
    setApiKey(trimmed);
    setIsKeyModalOpen(false);
    if (trimmed) {
      setMapMode('google');
    }
  };

  const handleLocationSelected = (loc: SelectedLocationData) => {
    if (onSetUserLocation) {
      onSetUserLocation(loc);
    }
    setIsUserLocationInfoOpen(true);
  };

  // Coordinate projection helper for Vector Spatial Map (Tamil Nadu & Chennai Corridor)
  const projectCoord = (lat: number, lng: number) => {
    // Bounds for Tamil Nadu corridor (approx Lat: 8.5 to 13.5, Lng: 76.5 to 80.5)
    // If coords are in Chennai metro (Lat ~12.9 to 13.2, Lng ~80.1 to 80.35)
    const isChennaiMetro = lat >= 12.8 && lat <= 13.3 && lng >= 80.0 && lng <= 80.4;
    const minLat = isChennaiMetro ? 12.98 : 8.5;
    const maxLat = isChennaiMetro ? 13.15 : 13.5;
    const minLng = isChennaiMetro ? 80.14 : 76.8;
    const maxLng = isChennaiMetro ? 80.32 : 80.4;
    const x = ((lng - minLng) / (maxLng - minLng)) * 900;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 620;
    return {
      x: Math.max(48, Math.min(840, x)),
      y: Math.max(44, Math.min(576, y)),
    };
  };

  return (
    <div className="relative w-full h-full min-h-[560px] bg-slate-900 overflow-hidden flex flex-col">
      {/* Top Map Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-slate-200 z-10 shrink-0 gap-2">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span className="font-semibold text-white tracking-tight flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-sky-400" />
            Tamil Nadu Medical & Pharma Corridor
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className="font-mono text-slate-400 tabular-nums">
            {userLocation
              ? `${userLocation.lat.toFixed(4)}°N, ${Math.abs(userLocation.lng).toFixed(4)}°E`
              : '13.0827° N, 80.2707° E'}
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

        {/* Map View Switcher & Key Config */}
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Map rendering layer"
            className="flex items-center bg-slate-800 p-0.5 rounded-md border border-slate-700"
          >
            <button
              type="button"
              onClick={() => setMapMode('google')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mapMode === 'google'
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Google Maps SDK
            </button>
            <button
              type="button"
              onClick={() => setMapMode('interactive')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mapMode === 'interactive'
                  ? 'bg-slate-100 text-slate-900 font-semibold shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Interactive Map (Free)
            </button>
            <button
              type="button"
              onClick={() => setMapMode('vector')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mapMode === 'vector'
                  ? 'bg-slate-100 text-slate-900 font-semibold shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Route Grid
            </button>
          </div>

          {/* Google Maps API Key Config Button */}
          <button
            type="button"
            onClick={() => {
              setInputKey(apiKey);
              setIsKeyModalOpen(true);
            }}
            className={`px-2 py-1 text-xs font-medium rounded border transition-colors flex items-center gap-1 cursor-pointer ${
              hasConfiguredGoogleMapsKey
                ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                : 'border-amber-600/50 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50'
            }`}
            title="Configure Google Maps API Key"
          >
            <Key className="w-3 h-3" />
            <span className="hidden sm:inline">
              {hasConfiguredGoogleMapsKey ? 'Key Active' : 'Set API Key'}
            </span>
          </button>
        </div>
      </div>

      {/* Real-Time Location Search & Autocomplete Toolbar */}
      <div className="px-4 py-2 bg-slate-900/95 border-b border-slate-800 z-10 shrink-0">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex-1 max-w-xl">
            <LocationAutocompleteInput
              value={locationSearchText}
              onChange={setLocationSearchText}
              onSelectLocation={handleLocationSelected}
              placeholder="Search or input location (e.g. Apollo Greams, RGGGH Chennai, Coimbatore, or GPS)..."
              extraKnownLocations={tasks.map((t) => ({
                name: t.facilityName,
                address: t.address,
                lat: t.lat,
                lng: t.lng,
              }))}
              showGPSButton={true}
            />
          </div>

          {userLocation ? (
            <div className="flex items-center gap-2 text-xs bg-blue-950/60 border border-blue-800 text-blue-200 px-3 py-1.5 rounded-lg">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
              </span>
              <span className="truncate max-w-[240px] font-medium">
                {userLocation.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (onRequestCreateTaskAtLocation) {
                    onRequestCreateTaskAtLocation(userLocation);
                  }
                }}
                className="ml-auto text-sky-400 hover:text-white underline text-[11px] whitespace-nowrap cursor-pointer"
              >
                + Add Order Here
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Locate className="w-3.5 h-3.5 text-sky-400" />
              <span>Click <b>GPS</b> or type an address to pin your real-time location</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Map Surface */}
      <div className="relative flex-1 w-full h-full">
        {/* MODE 1: Google Maps SDK */}
        {mapMode === 'google' && (
          hasConfiguredGoogleMapsKey ? (
            <APIProvider apiKey={apiKey} libraries={['routes', 'maps']}>
              <div className="w-full h-full" style={{ minHeight: '500px', height: '100%' }}>
                <GoogleMap
                  defaultCenter={userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : TN_CENTER}
                  defaultZoom={13}
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                  style={{ width: '100%', height: '100%' }}
                >
                  <GoogleMapCenterController
                    userLocation={userLocation}
                    selectedTask={activeTask}
                  />

                  <GoogleMapRoutePolylines
                    clusters={clusters}
                    selectedTempFilter={selectedTempFilter}
                  />

                  {/* User Real-Time Location Marker on Google Map */}
                  {userLocation && (
                    <Marker
                      position={{ lat: userLocation.lat, lng: userLocation.lng }}
                      title="Your Real-Time Location"
                      onClick={() => setIsUserLocationInfoOpen(true)}
                      icon={{
                        path: 'M 0,0 m -10,0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0',
                        scale: 1,
                        fillColor: '#2563eb',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 3,
                      }}
                    />
                  )}

                  {/* User Location Info Window */}
                  {userLocation && isUserLocationInfoOpen && (
                    <InfoWindow
                      position={{ lat: userLocation.lat, lng: userLocation.lng }}
                      onCloseClick={() => setIsUserLocationInfoOpen(false)}
                    >
                      <div className="p-1 text-slate-900 max-w-[240px]">
                        <div className="text-[10px] font-mono font-bold text-sky-600">
                          🎯 YOUR REAL-TIME LOCATION
                        </div>
                        <div className="text-sm font-bold mt-0.5">{userLocation.name}</div>
                        <div className="text-xs text-slate-600 mt-0.5">{userLocation.address}</div>
                        <div className="text-[11px] font-mono text-slate-500 mt-1">
                          {userLocation.lat.toFixed(4)}°N, {Math.abs(userLocation.lng).toFixed(4)}°W
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (onRequestCreateTaskAtLocation) {
                              onRequestCreateTaskAtLocation(userLocation);
                            }
                          }}
                          className="mt-2 w-full py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Delivery Order Here</span>
                        </button>
                      </div>
                    </InfoWindow>
                  )}

                  {/* Vehicle Markers */}
                  {visibleVehicles.map((vehicle) => (
                    <Marker
                      key={vehicle.id}
                      position={{ lat: vehicle.currentLat, lng: vehicle.currentLng }}
                      title={`${vehicle.name} (${vehicle.temperatureCapacity})`}
                      onClick={() => {
                        setSelectedVehicleId(vehicle.id);
                        onSelectTask(null);
                      }}
                      label={{
                        text: vehicle.id,
                        color: '#ffffff',
                        fontSize: '10px',
                        fontWeight: '700',
                      }}
                      icon={{
                        path: 'M -12,-8 L 12,-8 L 12,8 L -12,8 Z',
                        fillColor: vehicle.routeColor,
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2,
                        scale: 1,
                        labelOrigin: { x: 0, y: 0 },
                      }}
                    />
                  ))}

                  {/* Delivery Stop Markers */}
                  {visibleTasks.map((task) => {
                    const isSelected = task.orderId === selectedTaskOrderId;
                    const pinColor = tempStrokeColor[task.requiredTemp];
                    const label = task.stopSequence != null
                      ? String(task.stopSequence)
                      : task.priority === 'STAT' ? '!' : '•';
                    return (
                      <Marker
                        key={task.orderId}
                        position={{ lat: task.lat, lng: task.lng }}
                        title={`${task.orderId}: ${task.facilityName}`}
                        onClick={() => {
                          onSelectTask(task.orderId);
                          setSelectedVehicleId(null);
                        }}
                        label={{
                          text: label,
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: '700',
                        }}
                        icon={{
                          path: 'M 0,0 m -12,0 a 12,12 0 1,0 24,0 a 12,12 0 1,0 -24,0',
                          scale: isSelected ? 1.3 : 1,
                          fillColor: pinColor,
                          fillOpacity: 1,
                          strokeColor: isSelected ? '#fbbf24' : '#ffffff',
                          strokeWeight: isSelected ? 3 : 2,
                          labelOrigin: { x: 0, y: 0 },
                        }}
                      />
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
            /* Prompt to enter API Key or switch to Free Map */
            <div className="relative w-full h-full flex items-center justify-center bg-slate-950 p-6">
              <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-xl p-6 text-center shadow-2xl space-y-4">
                <div className="w-12 h-12 rounded-full bg-blue-900/40 border border-blue-500/40 flex items-center justify-center mx-auto text-sky-400">
                  <Key className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Enable Google Maps Platform SDK
                  </h3>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    To render official Google Maps tiles, 3D building outlines, and Google Routes API directions, enter your Google Maps API key below.
                  </p>
                </div>

                <div className="space-y-2">
                  <input
                    type="password"
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    placeholder="Paste AIzaSy... Google Maps API Key"
                    className="w-full px-3.5 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveApiKey(inputKey)}
                      disabled={!inputKey.trim()}
                      className="flex-1 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      Activate Google Maps
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapMode('interactive')}
                      className="flex-1 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                    >
                      Use Free Street Map
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  Don&apos;t have a key? The <b>Interactive Free Street Map</b> requires zero setup and works immediately with real streets and GPS location.
                </p>
              </div>
            </div>
          )
        )}

        {/* MODE 2: Interactive Real Street Map (Leaflet - Free, Zero Config) */}
        {mapMode === 'interactive' && (
          <React.Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center bg-[#0b1324] text-slate-400 text-xs">
                Loading Interactive Street Map...
              </div>
            }
          >
            <InteractiveLeafletMap
              vehicles={vehicles}
              tasks={tasks}
              clusters={clusters}
              selectedTempFilter={selectedTempFilter}
              selectedCourierFilter={selectedCourierFilter}
              selectedTaskOrderId={selectedTaskOrderId}
              onSelectTask={onSelectTask}
              userLocation={userLocation}
              onRequestCreateTaskAtLocation={onRequestCreateTaskAtLocation}
            />
          </React.Suspense>
        )}

        {/* MODE 3: High-Precision Vector Schematic Route Grid */}
        {mapMode === 'vector' && (
          <div
            data-testid="dispatcher-spatial-map"
            className="relative w-full h-full bg-[#0b1324] select-none overflow-hidden"
          >
            <svg
              viewBox="0 0 900 620"
              className="w-full h-full object-cover"
              aria-label="Tamil Nadu & Chennai Medical Courier Route Map"
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

              {/* Bay of Bengal Coastline & Tamil Nadu Land Surface */}
              <rect width="900" height="620" fill="#070d19" />
              <path
                d="M 45,620 L 40,210 Q 55,115 140,85 L 360,55 Q 520,40 645,95 L 775,215 Q 825,360 810,620 Z"
                fill="#0f172a"
                stroke="#1e293b"
                strokeWidth="2"
              />
              <rect width="900" height="620" fill="url(#sf-grid-major)" />

              {/* Major Arterial Tamil Nadu Corridors (GST Road, Anna Salai, Poonamallee High Rd, OMR) */}
              <g stroke="rgba(100, 116, 139, 0.28)" strokeWidth="2.5" fill="none">
                <path d="M 340,420 L 710,145" />
                <path d="M 560,65 L 560,560" />
                <path d="M 85,225 L 650,225" />
                <path d="M 650,225 L 690,580" />
                <path d="M 745,175 L 765,560" />
                <path d="M 355,140 L 355,560" />
              </g>

              {/* Neighborhood Reference Labels */}
              <g
                fill="rgba(148, 163, 184, 0.38)"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
                letterSpacing="1.5"
              >
                <text x="95" y="195">KILPAUK / STANLEY</text>
                <text x="365" y="295">ANNA SALAI CORRIDOR</text>
                <text x="575" y="195">PARK TOWN / RGGGH</text>
                <text x="720" y="265">ADYAR / GUINDY</text>
                <text x="580" y="425">OMR MED TECH</text>
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
                    <path
                      d={dPath}
                      fill="none"
                      stroke={cluster.routeColor}
                      strokeWidth="7"
                      strokeOpacity="0.22"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d={dPath}
                      fill="none"
                      stroke={cluster.routeColor}
                      strokeWidth="3"
                      strokeDasharray="8 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
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

              {/* User Real-Time Location on Vector Grid */}
              {userLocation && (() => {
                const pos = projectCoord(userLocation.lat, userLocation.lng);
                return (
                  <g transform={`translate(${pos.x}, ${pos.y})`} className="cursor-pointer">
                    <circle cx="0" cy="0" r="16" fill="rgba(56, 189, 248, 0.25)" className="animate-ping" />
                    <circle cx="0" cy="0" r="10" fill="#2563eb" stroke="#ffffff" strokeWidth="2.5" />
                    <text
                      x="16"
                      y="4"
                      fill="#38bdf8"
                      fontSize="10"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      YOU ARE HERE
                    </text>
                  </g>
                );
              })()}

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
          </div>
        )}

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

        {/* Map Legend Bar */}
        <div className="absolute bottom-3 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 bg-slate-900/95 border border-slate-800 px-3.5 py-2 rounded-md text-xs text-slate-300">
          <div className="flex items-center gap-4">
            <span className="font-medium text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              Cold-Chain Legend:
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
              ? `${clusters.reduce((acc, c) => acc + c.stops.length, 0)} stops routed`
              : 'Click "Optimize Routes" to compute multi-stop trajectories'}
          </div>
        </div>
      </div>

      {/* Google Maps API Key Modal */}
      {isKeyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 text-slate-100 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-sky-400" />
                Google Maps Platform API Key
              </h3>
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your Google Maps Platform JavaScript API Key. Your key is stored locally in your browser session (<code className="font-mono text-sky-400">localStorage</code>) and enables 3D maps and Google Routes Directions.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                API Key
              </label>
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              {apiKey && (
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('google_maps_api_key');
                    setApiKey('');
                    setInputKey('');
                    setIsKeyModalOpen(false);
                  }}
                  className="text-xs text-red-400 hover:text-red-300 underline cursor-pointer"
                >
                  Clear Key
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsKeyModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveApiKey(inputKey)}
                  className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer"
                >
                  Save Key
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
