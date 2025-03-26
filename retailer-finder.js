/**
 * Enhanced Store Locator Script
 * @author: danweboptic
 * @lastModified: 2025-03-26 11:38:46 UTC
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
  
  // Exit if map element doesn't exist
  if (!mapElement) {
    console.error('Map element not found');
    return;
  }
  
  // Google Maps variables
  let map;
  let markers = [];
  let infoWindow;
  let bounds;
  let geocoder;
  let clusterer;
  let searchBox;
  
  // Data storage
  let retailers = [];
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
      // Initialize Google Places Autocomplete
      searchBox = new google.maps.places.Autocomplete(searchInput, {
        types: ['geocode'],
        componentRestrictions: { country: settings.countryCode || 'US' }
      });
      
      searchBox.addListener('place_changed', function() {
        const place = searchBox.getPlace();
        if (!place.geometry) {
          return;
        }
        
        handlePlaceSelection(place);
      });
    } catch (error) {
      console.error('Error initializing autocomplete:', error);
    }
  }
  
  function initMap() {
    try {
      // Create map instance
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
      
      // Create info window for markers
      infoWindow = new google.maps.InfoWindow();
      
      // Create geocoder for address searches
      geocoder = new google.maps.Geocoder();
      
      // Create bounds instance for zooming to fit markers
      bounds = new google.maps.LatLngBounds();
      
      // Initialize MarkerClusterer using the new library
      clusterer = new markerClusterer.MarkerClusterer({
        map,
        markers: [],
        algorithm: new markerClusterer.SuperClusterAlgorithm({
          maxZoom: 16,
          radius: 60
        })
      });
      
      // Check if browser has saved location
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
      
      // Add map event listeners
      map.addListener('idle', saveMapState);
      map.addListener('zoom_changed', debounce(updateClusters, 100));
      
    } catch (error) {
      console.error('Error initializing map:', error);
      mapElement.innerHTML = 'Error loading map. Please refresh the page.';
    }
  }

  function addUserMarker(position) {
    // Remove existing user marker if any
    if (userMarker) {
      userMarker.setMap(null);
    }
    
    // Custom icon for user location
    const userIcon = {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: '#4285F4',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 2,
      scale: 7
    };
    
    // Create marker
    userMarker = new google.maps.Marker({
      position: position,
      map: map,
      icon: userIcon,
      zIndex: 1000, // Place above other markers
      title: 'Your Location'
    });
    
    // Add info window to user marker
    userMarker.addListener('click', function() {
      infoWindow.setContent('<div class="map-info-window"><strong>Your Location</strong></div>');
      infoWindow.open(map, userMarker);
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
          
          // Save to localStorage for future visits
          localStorage.setItem('retailer_finder_lat', userPosition.lat);
          localStorage.setItem('retailer_finder_lng', userPosition.lng);
          
          // Update map and fetch retailers
          map.setCenter(userPosition);
          addUserMarker(userPosition);
          fetchAllRetailers();
        },
        function(error) {
          console.error("Error getting location", error);
          if (silent) {
            // If silent mode and error, just fetch retailers with default position
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
    
    // Save to recent searches
    saveRecentSearch(place.formatted_address, userPosition);
    
    // Update map
    map.setCenter(userPosition);
    addUserMarker(userPosition);
    
    if (retailers.length > 0) {
      updateRetailersDistance();
      displayRetailers();
      updateMarkers();
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
        
        // Save to recent searches
        saveRecentSearch(query, userPosition);
        
        // Update map
        map.setCenter(userPosition);
        addUserMarker(userPosition);
        
        if (retailers.length > 0) {
          updateRetailersDistance();
          displayRetailers();
          updateMarkers();
        } else {
          fetchAllRetailers();
        }
      } else {
        console.error('Geocode was not successful:', status);
        retailerList.innerHTML = `<div class="no-results">Location not found. Please try a different search.</div>`;
      }
    });
  }

  function fetchAllRetailers() {
    retailerList.innerHTML = `<div class="retailer-finder__loading">${LOADING_TEXT}</div>`;
    
    fetch(API_URL)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        retailers = data;
        
        if (retailers.length === 0) {
          retailerList.innerHTML = `<div class="no-results">${NO_RESULTS_TEXT}</div>`;
          if (countElement) countElement.textContent = '0';
          return;
        }
        
        updateRetailersDistance();
        displayRetailers();
        addRetailersToMap();
        
        if (countElement) countElement.textContent = retailers.length;
      })
      .catch(error => {
        console.error('Error fetching retailers:', error);
        retailerList.innerHTML = `<div class="no-results">${ERROR_LOADING_TEXT}</div>`;
      });
  }

  function updateRetailersDistance() {
    if (userPosition) {
      retailers.forEach(retailer => {
        retailer.distance = calculateDistance(
          userPosition.lat,
          userPosition.lng,
          parseFloat(retailer.latitude),
          parseFloat(retailer.longitude)
        ) * DISTANCE_MULTIPLIER;
      });
      
      retailers.sort((a, b) => a.distance - b.distance);
    }
  }

  function displayRetailers() {
    retailerList.innerHTML = '';
    
    retailers.forEach((retailer, index) => {
      const retailerElement = document.createElement('div');
      retailerElement.className = 'retailer-item';
      retailerElement.dataset.index = index;
      
      const distanceHtml = retailer.distance
        ? `<div class="retailer-distance">${retailer.distance.toFixed(1)} ${DISTANCE_LABEL} away</div>`
        : '';
      
      retailerElement.innerHTML = `
        <div class="retailer-name">${retailer.name}</div>
        <div class="retailer-address">${retailer.address}, ${retailer.city}, ${retailer.postcode}</div>
        ${retailer.phone ? `<div class="retailer-phone">${retailer.phone}</div>` : ''}
        ${retailer.website ? `<div class="retailer-website"><a href="${retailer.website}" target="_blank" rel="noopener">Visit Website</a></div>` : ''}
        ${distanceHtml}
      `;
      
      retailerElement.addEventListener('click', function() {
        const index = parseInt(this.dataset.index);
        highlightRetailer(index);
      });
      
      retailerList.appendChild(retailerElement);
    });
  }

  function addRetailersToMap() {
    try {
      // Clear existing markers
      clearMarkers();
      
      // Reset bounds
      bounds = new google.maps.LatLngBounds();
      
      if (userPosition) {
        bounds.extend(userPosition);
      }
      
      // Create markers
      const newMarkers = retailers.map((retailer, index) => {
        const position = {
          lat: parseFloat(retailer.latitude),
          lng: parseFloat(retailer.longitude)
        };
        
        const marker = new google.maps.Marker({
          position: position,
          title: retailer.name,
          optimized: true
        });
        
        bounds.extend(position);
        
        const contentString = createInfoWindowContent(retailer);
        
        marker.addListener('click', function() {
          infoWindow.close();
          infoWindow.setContent(contentString);
          infoWindow.open(map, marker);
          highlightListItem(index);
        });
        
        return marker;
      });
      
      // Update markers array
      markers = newMarkers;
      
      // Update clusterer with new markers
      clusterer.clearMarkers();
      clusterer.addMarkers(markers);
      
      if (markers.length > 0) {
        map.fitBounds(bounds);
        
        const listener = google.maps.event.addListener(map, 'idle', function() {
          if (map.getZoom() > 15) {
            map.setZoom(15);
          }
          google.maps.event.removeListener(listener);
        });
      }
    } catch (error) {
      console.error('Error adding retailers to map:', error);
    }
  }

  function createInfoWindowContent(retailer) {
    return `
      <div class="map-info-window">
        <div class="map-info-title">${retailer.name}</div>
        <div class="map-info-address">${retailer.address}, ${retailer.city}<br>${retailer.postcode}</div>
        ${retailer.phone ? `<div class="map-info-contact">${retailer.phone}</div>` : ''}
        ${retailer.website ? `<div class="map-info-contact"><a href="${retailer.website}" target="_blank" rel="noopener">Visit Website</a></div>` : ''}
        ${retailer.distance ? `<div class="map-info-distance">${retailer.distance.toFixed(1)} ${DISTANCE_LABEL} away</div>` : ''}
      </div>
    `;
  }

  function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
  }

  function highlightRetailer(index) {
    infoWindow.close();
    
    highlightListItem(index);
    
    const marker = markers[index];
    if (marker) {
      const retailer = retailers[index];
      const contentString = createInfoWindowContent(retailer);
      
      infoWindow.setContent(contentString);
      infoWindow.open(map, marker);
      
      map.panTo(marker.getPosition());
    }
  }

  function highlightListItem(index) {
    const items = document.querySelectorAll('.retailer-item');
    items.forEach(item => item.classList.remove('active'));
    
    if (items[index]) {
      items[index].classList.add('active');
      items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  function saveMapState() {
    const center = map.getCenter();
    localStorage.setItem('retailer_finder_map_lat', center.lat());
    localStorage.setItem('retailer_finder_map_lng', center.lng());
    localStorage.setItem('retailer_finder_map_zoom', map.getZoom());
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function updateClusters() {
    if (clusterer) {
      clusterer.render();
    }
  }

  function saveRecentSearch(query, position) {
    let recentSearches = JSON.parse(localStorage.getItem('retailer_finder_recent') || '[]');
    
    const newSearch = {
      query,
      position,
      timestamp: new Date().toISOString()
    };
    
    recentSearches = recentSearches.filter(search => search.query !== query);
    recentSearches.unshift(newSearch);
    
    if (recentSearches.length > MAX_RECENT_SEARCHES) {
      recentSearches = recentSearches.slice(0, MAX_RECENT_SEARCHES);
    }
    
    localStorage.setItem('retailer_finder_recent', JSON.stringify(recentSearches));
    updateRecentSearchesUI();
  }

  function updateRecentSearchesUI() {
    const recentSearches = JSON.parse(localStorage.getItem('retailer_finder_recent') || '[]');
    const container = document.createElement('div');
    container.className = 'recent-searches';
    
    if (recentSearches.length > 0) {
      container.innerHTML = `
        <h4>Recent Searches</h4>
        <ul>
          ${recentSearches.map(search => `
            <li>
              <a href="#" data-lat="${search.position.lat}" data-lng="${search.position.lng}">${search.query}</a>
              <span class="search-time">${formatRelativeTime(new Date(search.timestamp))}</span>
            </li>
          `).join('')}
        </ul>
      `;
      
      container.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', function(e) {
          e.preventDefault();
          const lat = parseFloat(this.dataset.lat);
          const lng = parseFloat(this.dataset.lng);
          userPosition = { lat, lng };
          map.setCenter(userPosition);
          addUserMarker(userPosition);
          updateRetailersDistance();
          displayRetailers();
          updateMarkers();
        });
      });
    }
    
    const existingContainer = document.querySelector('.recent-searches');
    if (existingContainer) {
      existingContainer.replaceWith(container);
    } else {
      searchInput.parentNode.appendChild(container);
    }
  }

  function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  }
});