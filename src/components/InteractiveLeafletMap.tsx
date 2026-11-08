import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DeliveryTask, OptimizedRouteCluster, TemperatureCapacity, Vehicle } from '../types/logistics';
import { Layers, Navigation, Plus, Locate, ShieldCheck } from 'lucide-react';
import { SelectedLocationData } from './LocationAutocompleteInput';
import { calculateHaversineKm } from '../utils/optimizer';
import { computeRoadRouteWithNavigation, RoadRouteResult } from '../utils/roadRouting';

interface InteractiveLeafletMapProps {
  vehicles: Vehicle[];
  tasks: DeliveryTask[];
  clusters: OptimizedRouteCluster[];
  selectedTempFilter: TemperatureCapacity | 'All';
  selectedCourierFilter?: string;
  selectedTaskOrderId: string | null;
  onSelectTask: (orderId: string | null) => void;
  userLocation: SelectedLocationData | null;
  onCenterUserLocation?: () => void;
  onRequestCreateTaskAtLocation?: (location: SelectedLocationData) => void;
  onStartNavigation?: (task: DeliveryTask) => void;
}

// Default center: Chennai / Tamil Nadu, India
const DEFAULT_TN_CENTER: [number, number] = [13.0827, 80.2707];

const tempStrokeColor: Record<TemperatureCapacity, string> = {
  Frozen: '#0284c7', // Sky-600
  Refrigerated: '#0d9488', // Teal-600
  Ambient: '#4f46e5', // Indigo-600
};

export const InteractiveLeafletMap: React.FC<InteractiveLeafletMapProps> = ({
  vehicles,
  tasks,
  clusters,
  selectedTempFilter,
  selectedCourierFilter,
  selectedTaskOrderId,
  onSelectTask,
  userLocation,
  onCenterUserLocation,
  onRequestCreateTaskAtLocation,
  onStartNavigation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const [tileTheme, setTileTheme] = useState<'dark' | 'voyager' | 'osm'>('dark');
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [roadRoutes, setRoadRoutes] = useState<Record<string, RoadRouteResult>>({});

  // Compute realistic road-following corridor geometries & turn-by-turn steps
  useEffect(() => {
    let isCancelled = false;
    clusters.forEach(async (cluster) => {
      if (cluster.stops.length === 0) return;
      try {
        const roadRes = await computeRoadRouteWithNavigation(cluster.origin, cluster.stops);
        if (!isCancelled) {
          setRoadRoutes((prev) => ({ ...prev, [cluster.vehicleId]: roadRes }));
        }
      } catch {
        // fallback
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [clusters]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialCenter: [number, number] = userLocation
      ? [userLocation.lat, userLocation.lng]
      : DEFAULT_TN_CENTER;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: userLocation ? 14 : 12,
      zoomControl: false,
    });

    // Add custom zoom control in top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    const darkTiles = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }
    );
    darkTiles.addTo(map);
    tileLayerRef.current = darkTiles;

    const routesGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);
    routesLayerRef.current = routesGroup;
    markersLayerRef.current = markersGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle Tile Theme Switch
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    let url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    let attribution = '&copy; CARTO &copy; OpenStreetMap';

    if (tileTheme === 'voyager') {
      url = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    } else if (tileTheme === 'osm') {
      url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap contributors';
    }

    const newTileLayer = L.tileLayer(url, {
      attribution,
      subdomains: 'abcd',
      maxZoom: 19,
    });
    newTileLayer.addTo(map);
    tileLayerRef.current = newTileLayer;
  }, [tileTheme]);

  // Update Route Polylines and Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    const routesGroup = routesLayerRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !routesGroup || !markersGroup) return;

    routesGroup.clearLayers();
    markersGroup.clearLayers();

    const isSpecificCourier =
      selectedCourierFilter &&
      selectedCourierFilter !== 'All' &&
      selectedCourierFilter !== 'NEAR_GPS';
    const isNearGps = selectedCourierFilter === 'NEAR_GPS';

    const visibleClusters = clusters.filter((c) => {
      const matchesTemp =
        selectedTempFilter === 'All' || c.temperatureCapacity === selectedTempFilter;
      const matchesCourier = !isSpecificCourier || c.vehicleId === selectedCourierFilter;
      return c.stops.length > 0 && matchesTemp && matchesCourier;
    });

    const visibleVehicles = vehicles.filter((v) => {
      const matchesTemp =
        selectedTempFilter === 'All' || v.temperatureCapacity === selectedTempFilter;
      const matchesCourier = !isSpecificCourier || v.id === selectedCourierFilter;
      return matchesTemp && matchesCourier;
    });

    const visibleTasks = tasks.filter((t) => {
      const matchesTemp =
        selectedTempFilter === 'All' || t.requiredTemp === selectedTempFilter;
      if (!matchesTemp) return false;
      if (isNearGps) {
        if (!userLocation) return true;
        return (
          calculateHaversineKm(userLocation.lat, userLocation.lng, t.lat, t.lng) <= 35
        );
      }
      if (isSpecificCourier) {
        if (t.assignedVehicleId) {
          return t.assignedVehicleId === selectedCourierFilter;
        }
        const v = vehicles.find((veh) => veh.id === selectedCourierFilter);
        if (v) {
          const d = calculateHaversineKm(v.currentLat, v.currentLng, t.lat, t.lng);
          return (
            d <= (v.maxRadiusKm || 50) && t.requiredTemp === v.temperatureCapacity
          );
        }
      }
      return true;
    });

    // 1. Draw Multi-Stop Route Polylines (Following Real Paved Highways & Arterial Expressways)
    visibleClusters.forEach((cluster) => {
      if (cluster.stops.length === 0) return;
      const roadData = roadRoutes[cluster.vehicleId];
      const latLngs: [number, number][] =
        roadData && roadData.coordinates.length > 2
          ? roadData.coordinates
          : cluster.pathCoordinates.map((c) => [c.lat, c.lng]);

      if (latLngs.length < 2) return;

      // Outer glow casing
      L.polyline(latLngs, {
        color: cluster.routeColor,
        weight: 7,
        opacity: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routesGroup);

      // Core arterial road line
      L.polyline(latLngs, {
        color: cluster.routeColor,
        weight: 3.5,
        opacity: 0.95,
        dashArray: '8, 6',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routesGroup);
    });

    // 2. Draw Vehicle Hub / Courier Markers
    visibleVehicles.forEach((veh) => {
      const iconHtml = `
        <div style="background-color: ${veh.routeColor};" class="flex items-center gap-1 px-2 py-0.5 rounded shadow-lg border border-white text-white text-[10px] font-bold font-mono whitespace-nowrap cursor-pointer transition-transform hover:scale-110">
          <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2m10 0h2a2 2 0 0 0 2-2v-3.5a1.5 1.5 0 0 0-.44-1.06L17 8.5A2 2 0 0 0 15.5 8H14m0 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>
          <span>${veh.id}</span>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-vehicle-icon',
        html: iconHtml,
        iconSize: [80, 24],
        iconAnchor: [40, 12],
      });

      const marker = L.marker([veh.currentLat, veh.currentLng], { icon: customIcon }).addTo(markersGroup);

      marker.bindPopup(`
        <div style="min-width: 200px; font-family: sans-serif; padding: 4px;">
          <div style="font-size: 10px; font-weight: 700; color: ${veh.routeColor}; font-family: monospace;">
            ${veh.id} · ${veh.temperatureCapacity}
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px;">
            ${veh.name}
          </div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">
            ${veh.type} · ${veh.tempRangeLabel}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-top: 4px; border-top: 1px solid #e2e8f0; pt-2;">
            Hub: <b>${veh.hubName}</b><br/>Specialist: <b>${veh.driverName}</b>
          </div>
        </div>
      `);
    });

    // 3. Draw Delivery Stop Markers
    visibleTasks.forEach((task) => {
      const isSelected = task.orderId === selectedTaskOrderId;
      const pinColor = tempStrokeColor[task.requiredTemp];
      const badgeText =
        task.stopSequence !== null
          ? String(task.stopSequence)
          : task.priority === 'STAT'
          ? '!'
          : '•';

      const iconHtml = `
        <div style="background-color: ${pinColor}; ${isSelected ? 'transform: scale(1.3); outline: 3px solid #fbbf24;' : ''}" class="flex items-center justify-center w-7 h-7 rounded-full border-2 border-white shadow-md text-white font-mono text-xs font-bold transition-all hover:scale-125 cursor-pointer">
          ${badgeText}
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-task-icon',
        html: iconHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([task.lat, task.lng], { icon: customIcon }).addTo(markersGroup);

      marker.on('click', () => {
        onSelectTask(task.orderId);
      });

      marker.bindPopup(`
        <div style="min-width: 220px; font-family: sans-serif; padding: 4px;">
          <div style="font-size: 10px; font-weight: 700; color: #64748b; font-family: monospace;">
            ${task.orderId} · <span style="color: ${task.priority === 'STAT' ? '#dc2626' : '#2563eb'}">${task.priority}</span> · ${task.requiredTemp}
          </div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px;">
            ${task.facilityName}
          </div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">
            ${task.specimenType}
          </div>
          <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
            📍 ${task.address}
          </div>
          <div style="font-size: 11px; font-family: monospace; color: #334155; margin-top: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
            <span>Deadline: <b>${task.deadlineTime}</b></span>
            <span>${task.status === 'Optimized' ? `Stop #${task.stopSequence} (${task.assignedVehicleId})` : '<span style="color: #d97706;">Pending</span>'}</span>
          </div>
          <div style="font-size: 10px; color: #059669; font-weight: 600; margin-top: 5px; display: flex; align-items: center; gap: 4px;">
            <span>🛡️ Grade A Arterial Pavement · Low Congestion Bypass</span>
          </div>
          <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; gap: 6px;">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${task.lat},${task.lng}&travelmode=driving" target="_blank" rel="noreferrer" style="flex: 1; text-align: center; padding: 6px 10px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 11px; font-weight: 700; font-family: sans-serif; display: flex; align-items: center; justify-content: center; gap: 4px;">
              🧭 Launch Voice GPS
            </a>
          </div>
        </div>
      `);

      if (isSelected) {
        marker.openPopup();
      }
    });
  }, [vehicles, tasks, clusters, roadRoutes, selectedTempFilter, selectedCourierFilter, userLocation, selectedTaskOrderId, onSelectTask]);

  // Auto-center map when courier or GPS mode changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (selectedCourierFilter === 'NEAR_GPS' && userLocation) {
      map.flyTo([userLocation.lat, userLocation.lng], 12, { animate: true });
    } else if (
      selectedCourierFilter &&
      selectedCourierFilter !== 'All' &&
      selectedCourierFilter !== 'NEAR_GPS'
    ) {
      const veh = vehicles.find((v) => v.id === selectedCourierFilter);
      if (veh) {
        map.flyTo([veh.currentLat, veh.currentLng], 12, { animate: true });
      }
    }
  }, [selectedCourierFilter]);

  // Center on Selected Task
  useEffect(() => {
    if (!selectedTaskOrderId || !mapInstanceRef.current) return;
    const task = tasks.find((t) => t.orderId === selectedTaskOrderId);
    if (task) {
      mapInstanceRef.current.panTo([task.lat, task.lng], { animate: true, duration: 0.8 });
    }
  }, [selectedTaskOrderId, tasks]);

  // Handle User's Real-Time Location Marker & FlyTo
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (userMarkerRef.current) {
      map.removeLayer(userMarkerRef.current);
      userMarkerRef.current = null;
    }

    if (!userLocation) return;

    const { lat, lng, name, address } = userLocation;

    // Glowing animated GPS radar marker
    const pulseHtml = `
      <div class="relative flex items-center justify-center cursor-pointer">
        <span class="absolute w-10 h-10 rounded-full bg-sky-400 opacity-60 animate-ping"></span>
        <span class="absolute w-7 h-7 rounded-full bg-blue-500 opacity-40 animate-pulse"></span>
        <div class="relative w-6 h-6 rounded-full bg-blue-600 border-2 border-white shadow-xl flex items-center justify-center text-white">
          <svg style="width: 12px; height: 12px;" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>
        </div>
      </div>
    `;

    const userIcon = L.divIcon({
      className: 'user-gps-pulse-icon',
      html: pulseHtml,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    const marker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);

    const popupContent = document.createElement('div');
    popupContent.style.minWidth = '220px';
    popupContent.style.fontFamily = 'sans-serif';
    popupContent.style.padding = '4px';
    popupContent.innerHTML = `
      <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 700; color: #0284c7; font-family: monospace;">
        <span>🎯 YOUR REAL-TIME LOCATION</span>
      </div>
      <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 3px;">
        ${name || 'Current GPS Location'}
      </div>
      <div style="font-size: 11px; color: #475569; margin-top: 2px;">
        ${address || `${lat.toFixed(4)}°N, ${Math.abs(lng).toFixed(4)}°W`}
      </div>
      <div style="font-size: 10px; color: #64748b; font-family: monospace; margin-top: 4px; padding-top: 4px; border-top: 1px solid #e2e8f0;">
        Coordinates: ${lat.toFixed(4)}° N, ${Math.abs(lng).toFixed(4)}° W
      </div>
      <div style="margin-top: 8px;">
        <button id="leaflet-create-task-btn" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 6px 10px; background-color: #2563eb; color: #ffffff; border: none; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;">
          <span>➕ Add Delivery Order Here</span>
        </button>
      </div>
    `;

    popupContent.querySelector('#leaflet-create-task-btn')?.addEventListener('click', () => {
      if (onRequestCreateTaskAtLocation) {
        onRequestCreateTaskAtLocation(userLocation);
      }
    });

    marker.bindPopup(popupContent);
    userMarkerRef.current = marker;

    // Smoothly fly to user's real-time position
    map.flyTo([lat, lng], 14, { duration: 1.2 });
  }, [userLocation, onRequestCreateTaskAtLocation]);

  return (
    <div className="relative w-full h-full min-h-[500px]">
      <div ref={mapContainerRef} className="w-full h-full bg-[#0b1324] z-0" />

      {/* Floating Map Controls in Top Right */}
      <div className="absolute top-3 right-12 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-xs p-1 rounded-lg border border-slate-700 shadow-lg text-xs">
        <button
          type="button"
          onClick={() => setTileTheme('dark')}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            tileTheme === 'dark' ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-white'
          }`}
          title="Dark Medical Grid Map"
        >
          Dark
        </button>
        <button
          type="button"
          onClick={() => setTileTheme('voyager')}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            tileTheme === 'voyager' ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-white'
          }`}
          title="Voyager Street Map"
        >
          Streets
        </button>
        <button
          type="button"
          onClick={() => setTileTheme('osm')}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            tileTheme === 'osm' ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-white'
          }`}
          title="OpenStreetMap Standard"
        >
          OSM
        </button>

        {userLocation && (
          <button
            type="button"
            onClick={() => {
              if (mapInstanceRef.current && userLocation) {
                mapInstanceRef.current.flyTo([userLocation.lat, userLocation.lng], 15, { duration: 1 });
              }
            }}
            className="ml-1 p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition-colors"
            title="Recenter on My Real-time Location"
          >
            <Locate className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">My GPS</span>
          </button>
        )}
      </div>
    </div>
  );
};
