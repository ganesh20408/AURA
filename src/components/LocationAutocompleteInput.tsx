import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, Loader2, Check, Search, X, Sparkles } from 'lucide-react';
import { KNOWN_MEDICAL_LOCATIONS, KnownLocation } from '../utils/knownLocations';

export interface SelectedLocationData {
  name: string;
  address: string;
  lat: number;
  lng: number;
  isRealTimeGPS?: boolean;
}

interface LocationAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelectLocation?: (location: SelectedLocationData) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  autoFocus?: boolean;
  required?: boolean;
  showGPSButton?: boolean;
  onGPSStart?: () => void;
  onGPSEnd?: () => void;
  extraKnownLocations?: Array<{ name: string; address?: string; lat: number; lng: number }>;
}

export const LocationAutocompleteInput: React.FC<LocationAutocompleteInputProps> = ({
  value,
  onChange,
  onSelectLocation,
  placeholder = 'Type address, hospital, or enter coordinates...',
  className = '',
  id,
  autoFocus = false,
  required = false,
  showGPSButton = true,
  onGPSStart,
  onGPSEnd,
  extraKnownLocations = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isLocatingGPS, setIsLocatingGPS] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<
    Array<{ name: string; address: string; lat: number; lng: number; isGeocoded?: boolean }>
  >([]);
  const [isSearchingGeocode, setIsSearchingGeocode] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Combine static known locations with any extra locations passed
  const allKnown: KnownLocation[] = React.useMemo(() => {
    const list: KnownLocation[] = [...KNOWN_MEDICAL_LOCATIONS];
    if (extraKnownLocations.length > 0) {
      extraKnownLocations.forEach((loc) => {
        if (!list.some((k) => k.name.toLowerCase() === loc.name.toLowerCase())) {
          list.push({
            name: loc.name,
            address: loc.address || `${loc.name}, San Francisco, CA`,
            lat: loc.lat,
            lng: loc.lng,
            category: 'Clinic',
          });
        }
      });
    }
    return list;
  }, [extraKnownLocations]);

  // Filter known locations based on the current typed input
  const query = value.trim().toLowerCase();

  const matchingKnown = React.useMemo(() => {
    if (!query) return allKnown.slice(0, 8); // show initial popular hospitals if input is empty
    return allKnown.filter(
      (k) =>
        k.name.toLowerCase().includes(query) ||
        k.address.toLowerCase().includes(query) ||
        k.category.toLowerCase().includes(query)
    );
  }, [query, allKnown]);

  // Dynamic geocoding for addresses outside the known list (via Nominatim OSM API)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (!query || query.length < 3) {
      setDynamicSuggestions([]);
      setIsSearchingGeocode(false);
      return;
    }

    // If query matches known locations with high exactness, no immediate need to spam geocoder
    const exactMatch = allKnown.some(
      (k) => k.name.toLowerCase() === query || k.address.toLowerCase() === query
    );
    if (exactMatch) {
      setDynamicSuggestions([]);
      return;
    }

    debounceTimerRef.current = window.setTimeout(async () => {
      setIsSearchingGeocode(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        // Biased towards Tamil Nadu / India if no country specified
        const searchParam = query.includes(',') ? query : `${query}, Tamil Nadu, India`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            searchParam
          )}&limit=5&addressdetails=1`,
          {
            signal: controller.signal,
            headers: {
              'Accept-Language': 'en',
            },
          }
        );

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const mapped = data.map((item: any) => ({
              name: item.name || item.display_name.split(',')[0],
              address: item.display_name,
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
              isGeocoded: true,
            }));
            setDynamicSuggestions(mapped);
          } else {
            setDynamicSuggestions([]);
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          // silently fail geocoding
        }
      } finally {
        setIsSearchingGeocode(false);
      }
    }, 350);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query, allKnown]);

  // Combine items for dropdown
  interface DropdownItem {
    id: string;
    type: 'known' | 'geocoded' | 'custom';
    name: string;
    address: string;
    lat: number;
    lng: number;
    category?: string;
  }

  const dropdownItems: DropdownItem[] = React.useMemo(() => {
    const items: DropdownItem[] = [];

    // 1. Matching known locations
    matchingKnown.slice(0, 6).forEach((k, idx) => {
      items.push({
        id: `known-${idx}`,
        type: 'known',
        name: k.name,
        address: k.address,
        lat: k.lat,
        lng: k.lng,
        category: k.category,
      });
    });

    // 2. Dynamic geocoded results
    dynamicSuggestions.forEach((g, idx) => {
      // Don't duplicate if already in known
      if (!items.some((it) => it.name.toLowerCase() === g.name.toLowerCase())) {
        items.push({
          id: `geocode-${idx}`,
          type: 'geocoded',
          name: g.name,
          address: g.address,
          lat: g.lat,
          lng: g.lng,
          category: 'Street Address',
        });
      }
    });

    // 3. Always include option to use custom typed text till the end
    if (query.length > 0) {
      // Check if user typed coordinates like "13.08, 80.27"
      const coordMatch = query.match(/^([+-]?\d+(\.\d+)?),\s*([+-]?\d+(\.\d+)?)$/);
      let customLat = 13.0827;
      let customLng = 80.2707;
      if (coordMatch) {
        customLat = parseFloat(coordMatch[1]);
        customLng = parseFloat(coordMatch[3]);
      } else if (items.length > 0) {
        // Default to first matched coordinate or approximate
        customLat = items[0].lat;
        customLng = items[0].lng;
      }

      items.push({
        id: 'custom-entry',
        type: 'custom',
        name: value,
        address: coordMatch ? `Coordinates (${customLat}, ${customLng})` : `${value}, Tamil Nadu, India`,
        lat: customLat,
        lng: customLng,
        category: 'New Custom Location',
      });
    }

    return items;
  }, [matchingKnown, dynamicSuggestions, query, value]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (item: DropdownItem) => {
    onChange(item.name);
    setIsOpen(false);
    if (onSelectLocation) {
      onSelectLocation({
        name: item.name,
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        isRealTimeGPS: false,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < dropdownItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : dropdownItems.length - 1));
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < dropdownItems.length) {
        e.preventDefault();
        handleSelect(dropdownItems[highlightedIndex]);
      } else if (value.trim()) {
        // Allow typing till the end and pressing Enter directly!
        setIsOpen(false);
        if (onSelectLocation) {
          const firstItem = dropdownItems[0];
          onSelectLocation({
            name: value.trim(),
            address: firstItem?.address || `${value.trim()}, Tamil Nadu, India`,
            lat: firstItem?.lat || 13.0827 + (Math.random() - 0.5) * 0.04,
            lng: firstItem?.lng || 80.2707 + (Math.random() - 0.5) * 0.04,
          });
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Real-Time GPS Location Detection
  const handleDetectGPS = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    setGpsError(null);

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocatingGPS(true);
    if (onGPSStart) onGPSStart();

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        let formattedName = `Real-Time Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
        let detailedAddress = `GPS Location ±${Math.round(accuracy)}m`;

        try {
          // Attempt reverse geocoding to human readable street
          const revRes = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          if (revRes.ok) {
            const revData = await revRes.json();
            if (revData && revData.display_name) {
              const parts = revData.display_name.split(',');
              formattedName = parts.slice(0, 2).join(',').trim();
              detailedAddress = revData.display_name;
            }
          }
        } catch {
          // Fall back to coordinate string
        }

        onChange(formattedName);
        setIsLocatingGPS(false);
        setIsOpen(false);
        if (onGPSEnd) onGPSEnd();

        if (onSelectLocation) {
          onSelectLocation({
            name: formattedName,
            address: detailedAddress,
            lat: latitude,
            lng: longitude,
            isRealTimeGPS: true,
          });
        }
      },
      (err) => {
        setIsLocatingGPS(false);
        if (onGPSEnd) onGPSEnd();
        let message = 'Unable to retrieve your location.';
        if (err.code === 1) message = 'Location permission denied. Please allow location access in your browser.';
        else if (err.code === 2) message = 'Location position unavailable.';
        else if (err.code === 3) message = 'Location request timed out.';
        setGpsError(message);
        setTimeout(() => setGpsError(null), 5000);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />

        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          autoFocus={autoFocus}
          required={required}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          className={`w-full pl-9 pr-20 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all ${className}`}
        />

        {/* Action icons right inside the input: Clear + GPS Detect */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
              title="Clear text"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {showGPSButton && (
            <button
              type="button"
              disabled={isLocatingGPS}
              onClick={handleDetectGPS}
              className={`p-1.5 rounded-md flex items-center gap-1 text-[11px] font-medium transition-colors ${
                isLocatingGPS
                  ? 'bg-blue-100 text-blue-700 animate-pulse'
                  : 'text-slate-600 hover:text-blue-600 hover:bg-blue-50'
              }`}
              title="Use My Real-time GPS Location"
            >
              {isLocatingGPS ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
              ) : (
                <Navigation className="w-3.5 h-3.5 text-blue-600" />
              )}
              <span className="hidden sm:inline font-sans font-semibold">GPS</span>
            </button>
          )}
        </div>
      </div>

      {gpsError && (
        <div className="mt-1 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2.5 py-1">
          {gpsError}
        </div>
      )}

      {/* Autocomplete Dropdown */}
      {isOpen && dropdownItems.length > 0 && (
        <div
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl divide-y divide-slate-100 text-xs"
        >
          {/* Header indicator */}
          <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-medium text-slate-500 flex items-center justify-between">
            <span>
              {query ? 'Matching Known Facilities & Addresses' : 'Available Medical Centers (Click or Type Custom)'}
            </span>
            {isSearchingGeocode && (
              <span className="flex items-center gap-1 text-blue-600 font-mono text-[10px]">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> Searching...
              </span>
            )}
          </div>

          {dropdownItems.map((item, idx) => {
            const isHighlighted = idx === highlightedIndex;
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={isHighlighted}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={`px-3 py-2 cursor-pointer flex items-start gap-2.5 transition-colors ${
                  isHighlighted ? 'bg-blue-50 text-slate-900' : 'hover:bg-slate-50 text-slate-800'
                }`}
              >
                {item.type === 'custom' ? (
                  <Sparkles className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                ) : item.type === 'geocoded' ? (
                  <Search className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                ) : (
                  <MapPin className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 truncate">
                      {item.type === 'custom' ? `Use Entered Location: "${item.name}"` : item.name}
                    </span>
                    {item.category && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono shrink-0">
                        {item.category}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5 font-sans">
                    {item.address}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {item.lat.toFixed(4)}°N, {Math.abs(item.lng).toFixed(4)}°W
                  </div>
                </div>

                {value.toLowerCase() === item.name.toLowerCase() && (
                  <Check className="w-4 h-4 text-emerald-600 mt-1 shrink-0" />
                )}
              </div>
            );
          })}

          {/* Footer note: user can type custom location till the end */}
          <div className="px-3 py-1.5 bg-slate-50 text-[10px] text-slate-500 flex items-center justify-between">
            <span>💡 You can freely type any new custom location till the end.</span>
            <span className="font-mono text-slate-400">Press Enter to accept</span>
          </div>
        </div>
      )}
    </div>
  );
};
