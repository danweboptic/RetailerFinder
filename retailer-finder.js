/**
 * Store Locator Script
 * @author: danweboptic
 * @lastModified: 2025-03-26 16:18:41 UTC
 */

document.addEventListener('DOMContentLoaded', function() {
  // First check if required libraries are loaded
  if (typeof google === 'undefined') {
    console.error('Google Maps API is not loaded');
    return;
  }

  if (typeof markerClusterer === 'undefined') {
    console.error('MarkerClusterer library is not loaded');
    return;
  }

  // Get settings from global variable
  const settings = window.retailerFinderSettings || {};

  // Configuration
  const API_URL = settings.apiUrl || '/admin/api/retailers';
  const DEFAULT_LAT = parseFloat(settings.defaultLat) || 51.32946017198823;
  const DEFAULT_LNG = parseFloat(settings.defaultLng) || -0.590516176321099;
  const DEFAULT_ZOOM = 10;
  const DISTANCE_UNIT = settings.distanceUnit || 'miles';
  const DISTANCE_MULTIPLIER = DISTANCE_UNIT === 'kilometers' ? 1.60934 : 1;
  const DISTANCE_LABEL = DISTANCE_UNIT === 'kilometers' ? 'km' : 'miles';
  const MAX_RECENT_SEARCHES = 5;

  // Text strings
  const LOADING_TEXT = settings.loadingText || 'Loading retailers...';
  const NO_RESULTS_TEXT = settings.noResultsText || 'No retailers found in this area.';
  const ERROR_LOADING_TEXT = settings.errorLoadingText || 'Error loading retailers. Please try again.';
  const LOCATION_ERROR_TEXT = settings.locationErrorText || 'Unable to get your location. Please enter a location manually.';
  const GEOLOCATION_NOT_SUPPORTED_TEXT = settings.geolocationNotSupportedText || 'Geolocation is not supported by your browser. Please enter a location manually.';

  // DOM Elements
  const searchInput = document.getElementById('retailer-search');
  const searchBtn = document.getElementById('search-btn');
  const useMyLocationBtn = document.getElementById('use-my-location-btn');
  const retailerList = document.getElementById('retailer-list');
  const countElement = document.getElementById('count');
  const mapElement = document.getElementById('retailer-map');

  // Google Maps variables
  let map;
  let markers = [];
  let bounds;
  let geocoder;
  let clusterer;
  let searchBox;

  // Data storage
  let retailers = [];
  let allRetailers = [];
  let userPosition = null;
  let userMarker = null;

  // Initialize app
  initMap();
  initAutocomplete();

  // Event Listeners
  if (searchBtn) {
    searchBtn.addEventListener('click', handleSearch);
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        handleSearch();
      }
    });
  }

  if (useMyLocationBtn) {
    useMyLocationBtn.addEventListener('click', function() {
      getUserLocation(false);
    });
  }

  function initAutocomplete() {
    try {
      searchBox = new google.maps.places.Autocomplete(searchInput, {
        types: ['geocode'],
        componentRestrictions: { country: settings.countryCode || 'GB' }
      });

      searchBox.addListener('place_changed', function() {
        const place = searchBox.getPlace();
        if (!place.geometry) return;
        handlePlaceSelection(place);
      });
    } catch (error) {
      console.error('Error initializing autocomplete:', error);
    }
  }

  function initMap() {
    try {
      map = new google.maps.Map(mapElement, {
        center: { lat: DEFAULT_LAT, lng: DEFAULT_LNG },
        zoom: DEFAULT_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        styles: [
          {
            featureType: "poi",
            elementType: "labels",
            stylers: [{ visibility: "off" }]
          }
        ]
      });

      geocoder = new google.maps.Geocoder();
      bounds = new google.maps.LatLngBounds();

      clusterer = new markerClusterer.MarkerClusterer({
        map,
        markers: [],
        algorithm: new markerClusterer.SuperClusterAlgorithm({
          maxZoom: 16,
          radius: 60
        })
      });

      const savedLat = localStorage.getItem('retailer_finder_lat');
      const savedLng = localStorage.getItem('retailer_finder_lng');

      if (savedLat && savedLng) {
        userPosition = {
          lat: parseFloat(savedLat),
          lng: parseFloat(savedLng)
        };
        map.setCenter(userPosition);
        addUserMarker(userPosition);
        fetchAllRetailers();
      } else {
        getUserLocation(true);
      }

    } catch (error) {
      console.error('Error initializing map:', error);
      mapElement.innerHTML = 'Error loading map. Please refresh the page.';
    }
  }

  function addUserMarker(position) {
    if (userMarker) {
      userMarker.setMap(null);
    }

    const userIcon = {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: '#4285F4',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 2,
      scale: 7
    };

    userMarker = new google.maps.Marker({
      position: position,
      map: map,
      icon: userIcon,
      zIndex: 1000,
      title: 'Your Location'
    });
  }

  function getUserLocation(silent = false) {
    if (navigator.geolocation) {
      if (!silent) {
        retailerList.innerHTML = `<div class="retailer-finder__loading">Getting your location...</div>`;
      }

      navigator.geolocation.getCurrentPosition(
        function(position) {
          userPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };

          localStorage.setItem('retailer_finder_lat', userPosition.lat);
          localStorage.setItem('retailer_finder_lng', userPosition.lng);

          map.setCenter(userPosition);
          map.setZoom(11);
          addUserMarker(userPosition);
          fetchAllRetailers();
        },
        function(error) {
          console.error("Error getting location", error);
          if (silent) {
            fetchAllRetailers();
          } else {
            retailerList.innerHTML = `<div class="no-results">${LOCATION_ERROR_TEXT}</div>`;
          }
        }
      );
    } else {
      if (!silent) {
        retailerList.innerHTML = `<div class="no-results">${GEOLOCATION_NOT_SUPPORTED_TEXT}</div>`;
      }
      fetchAllRetailers();
    }
  }

  function handlePlaceSelection(place) {
    userPosition = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng()
    };

    saveRecentSearch(place.formatted_address, userPosition);
    map.setCenter(userPosition);
    map.setZoom(11);
    addUserMarker(userPosition);

    if (allRetailers.length > 0) {
      updateRetailers();
    } else {
      fetchAllRetailers();
    }
  }

  function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    retailerList.innerHTML = `<div class="retailer-finder__loading">Searching for location...</div>`;

    geocoder.geocode({ 'address': query }, function(results, status) {
      if (status === 'OK') {
        userPosition = {
          lat: results[0].geometry.location.lat(),
          lng: results[0].geometry.location.lng()
        };

        saveRecentSearch(query, userPosition);
        map.setCenter(userPosition);
        map.setZoom(11);
        addUserMarker(userPosition);

        if (allRetailers.length > 0) {
          updateRetailers();
        } else {
          fetchAllRetailers();
        }
      } else {
        console.error('Geocode was not successful:', status);
        retailerList.innerHTML = `<div class="no-results">Location not found. Please try a different search.</div>`;
      }
    });
  }

  async function fetchAllRetailers() {
    try {
      retailerList.innerHTML = `<div class="retailer-finder__loading">${LOADING_TEXT}</div>`;

      const response = await fetch(API_URL);
      if (!response.ok) throw new Error('Failed to fetch retailers');

      allRetailers = await response.json();

      if (allRetailers.length === 0) {
        retailerList.innerHTML = `<div class="no-results">${NO_RESULTS_TEXT}</div>`;
        if (countElement) countElement.textContent = '0';
        return;
      }

      updateRetailers();
    } catch (error) {
      console.error('Error fetching retailers:', error);
      retailerList.innerHTML = `<div class="retailer-finder__error">${ERROR_LOADING_TEXT}</div>`;
    }
  }

  function updateRetailers() {
    if (!userPosition) {
      retailers = [...allRetailers];
    } else {
      retailers = allRetailers.map(retailer => ({
        ...retailer,
        distance: calculateDistance(
          userPosition.lat,
          userPosition.lng,
          parseFloat(retailer.latitude),
          parseFloat(retailer.longitude)
        ) * DISTANCE_MULTIPLIER
      }))
      .sort((a, b) => a.distance - b.distance);
    }

    displayRetailers();
    updateMarkers();

    if (countElement) {
      countElement.textContent = retailers.length;
    }
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Radius of the Earth in miles
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function toRad(value) {
    return value * Math.PI / 180;
  }

  function displayRetailers() {
    retailerList.innerHTML = '';

    if (retailers.length === 0) {
      retailerList.innerHTML = `<div class="no-results">${NO_RESULTS_TEXT}</div>`;
      return;
    }

    retailers.forEach((retailer, index) => {
      const retailerElement = document.createElement('div');
      retailerElement.className = 'retailer-item';
      retailerElement.dataset.index = index;

      const numberLabel = `<div class="retailer-number">${index + 1}</div>`;

      const distanceHtml = retailer.distance
        ? `<div class="retailer-distance">${retailer.distance.toFixed(1)} ${DISTANCE_LABEL} away</div>`
        : '';

      retailerElement.innerHTML = `
        ${numberLabel}
        <div class="retailer-details">
          <div class="retailer-name">${retailer.name}</div>
          <div class="retailer-address">${retailer.address}, ${retailer.city}, ${retailer.postcode}</div>
          ${retailer.phone ? `<div class="retailer-phone">${retailer.phone}</div>` : ''}
          ${retailer.website ? `<div class="retailer-website"><a href="${retailer.website}" target="_blank" rel="noopener">Visit Website</a></div>` : ''}
          ${distanceHtml}
        </div>
      `;

      retailerElement.addEventListener('click', () => highlightRetailer(index));
      retailerList.appendChild(retailerElement);
    });
  }

  function updateMarkers() {
    clearMarkers();
    bounds = new google.maps.LatLngBounds();

    if (userPosition) {
      bounds.extend(userPosition);
    }

    const newMarkers = retailers.map((retailer, index) => {
      const position = {
        lat: parseFloat(retailer.latitude),
        lng: parseFloat(retailer.longitude)
      };

      const marker = new google.maps.Marker({
        position: position,
        map: map,
        label: {
          text: (index + 1).toString(),
          color: '#FFFFFF',
          fontSize: '14px',
          fontWeight: 'bold'
        },
        title: retailer.name,
        optimized: true
      });

      bounds.extend(position);

      marker.addListener('click', () => {
        highlightListItem(index);
        map.setCenter(marker.getPosition());
        if (map.getZoom() < 13) {
          map.setZoom(13);
        }
      });

      return marker;
    });

    markers = newMarkers;
    clusterer.clearMarkers();
    clusterer.addMarkers(markers);

    if (markers.length > 0) {
      map.fitBounds(bounds);
    }
  }

  function highlightListItem(index) {
    const items = retailerList.getElementsByClassName('retailer-item');
    Array.from(items).forEach(item => item.classList.remove('active'));
    
    const activeItem = retailerList.querySelector(`[data-index="${index}"]`);
    if (activeItem) {
      activeItem.classList.add('active');
      
      const containerRect = retailerList.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      
      // Calculate if item is in view
      const itemTop = itemRect.top - containerRect.top;
      const itemBottom = itemRect.bottom - containerRect.top;
      
      // Define the visible area with padding
      const visibleAreaPadding = 20;
      const visibleAreaTop = visibleAreaPadding;
      const visibleAreaBottom = containerRect.height - visibleAreaPadding;
      
      // Check if item needs scrolling
      if (itemTop < visibleAreaTop || itemBottom > visibleAreaBottom) {
        let newScrollTop;
        
        if (itemTop < visibleAreaTop) {
          newScrollTop = retailerList.scrollTop + (itemTop - visibleAreaTop);
        } else {
          newScrollTop = retailerList.scrollTop + (itemBottom - visibleAreaBottom);
        }
        
        retailerList.scrollTo({
          top: Math.max(0, newScrollTop),
          behavior: 'smooth'
        });
      }
    }
  }

  function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
  }

  function highlightRetailer(index) {
    const marker = markers[index];
    if (marker) {
      map.setCenter(marker.getPosition());
      if (map.getZoom() < 13) {
        map.setZoom(13);
      }
    }
    highlightListItem(index);
  }

  function saveMapState() {
    if (map) {
      const center = map.getCenter();
      const zoom = map.getZoom();

      localStorage.setItem('map_center_lat', center.lat());
      localStorage.setItem('map_center_lng', center.lng());
      localStorage.setItem('map_zoom', zoom);
    }
  }

  function saveRecentSearch(query, position) {
    try {
      let recentSearches = JSON.parse(localStorage.getItem('recent_searches') || '[]');

      const newSearch = {
        query: query,
        position: position,
        timestamp: new Date().toISOString()
      };

      recentSearches.unshift(newSearch);

      if (recentSearches.length > MAX_RECENT_SEARCHES) {
        recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
      }

      localStorage.setItem('recent_searches', JSON.stringify(recentSearches));
    } catch (error) {
      console.error('Error saving recent search:', error);
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
});
