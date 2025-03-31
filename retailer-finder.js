/**
 * Store Locator Script
 * @author: danweboptic
 * @lastModified: 2025-03-28 12:19:43 UTC
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
  const SEARCH_ZOOM = settings.searchZoom || 12;  // Default zoom level after search
  const MARKER_ZOOM = settings.markerZoom || 13;  // Reduced zoom level when clicking on a retailer
  const DISTANCE_UNIT = settings.distanceUnit || 'miles';
  const DISTANCE_MULTIPLIER = DISTANCE_UNIT === 'kilometers' ? 1.60934 : 1;
  const DISTANCE_LABEL = DISTANCE_UNIT === 'kilometers' ? 'km' : 'miles';
  const MAX_RECENT_SEARCHES = 5;

  // Map animation settings
  const MAP_ANIMATION_DURATION = settings.mapAnimationDuration || 750; // in milliseconds
  const MAP_ANIMATION_EASING = settings.mapAnimationEasing || 'easeOutCubic'; // Easing function for map movement

  // Premium retailer levels (always display on map regardless of distance)
  const PREMIUM_LEVELS = settings.premiumLevels || [4]; // Only Level 4 (V4 HQ)

  // Dynamic nearby retailers settings
  const MIN_NEARBY_RETAILERS = settings.minNearbyRetailers || 5; // Minimum retailers to show in viewport
  const MAX_NEARBY_RETAILERS = settings.maxNearbyRetailers || 20; // Maximum retailers to show in viewport
  const ALWAYS_SHOW_RETAILERS = settings.alwaysShowRetailers !== false; // Always ensure retailers are visible on the map
  const MIN_RETAILERS_TO_SHOW = settings.minRetailersToShow || 3; // Minimum number of retailers to show on map

  // Performance settings for large datasets
  const INITIAL_DISPLAY_LIMIT = settings.initialDisplayLimit || 100; // Number of retailers to display initially in list
  const MAX_MARKERS = settings.maxMarkers || 300; // Maximum number of markers to show on map at once

  // Level-specific weighting for sorting (higher level = higher priority)
  // Can be configured in settings or falls back to defaults
  const LEVEL_WEIGHTS = settings.levelWeights || {
    1: 5,  // Gold Account: 5 miles advantage
    2: 10, // Retail Partner: 10 miles advantage
    3: 15, // Design Hub: 15 miles advantage
    4: 20  // V4 HQ: 20 miles advantage
  };

  // Level definitions
  const LEVEL_NAMES = {
    1: 'Gold Account',
    2: 'Retail Partner',
    3: 'Design Hub',
    4: 'V4 HQ'
  };

  // Marker colors for each level
  const LEVEL_COLORS = {
    1: '#a89563', // Gold for Gold Account
    2: '#2d2d2c', // Dark Grey for Retail Partner
    3: '#346d43', // Green for Design Hub
    4: '#96632a'  // Brown for V4 HQ
  };

  // Optional custom marker images - can be set in settings
  const MARKER_IMAGES = settings.markerImages || {
    // Example format: 1: '/images/gold-marker.png'
    // If not specified, will use colored pin markers
  };

  // Default marker size for image markers
  const DEFAULT_MARKER_SIZE = settings.defaultMarkerSize || { width: 30, height: 40 };

  // User location marker settings
  const USER_MARKER_COLOR = settings.userMarkerColor || '#6d8dbe'; // Red for user location
  const USER_MARKER_SCALE = settings.userMarkerScale || 10; // Larger marker for user location
  const USER_MARKER_BORDER = settings.userMarkerBorder || 3; // Thicker border for visibility
  const USER_MARKER_ANIMATION = settings.useMarkerAnimation !== false; // Animation for user marker

  // Location type zoom levels - used to determine appropriate zoom based on search query
  const LOCATION_TYPE_ZOOM = {
    country: 5,
    administrative_area_level_1: 7, // State/Province/Region
    administrative_area_level_2: 9, // County
    locality: 12, // City
    sublocality: 13, // District
    neighborhood: 14,
    route: 15,
    street_address: 16,
    postal_code: 12,
    default: 12 // Default level if type can't be determined
  };

  // Search this area settings
  const SEARCH_AREA_BUTTON_TEXT = settings.searchAreaButtonText || 'Search this area';
  const MAP_IDLE_DELAY = settings.mapIdleDelay || 500; // Delay in ms before showing "Search this area" button

  // Text strings
  const LOADING_TEXT = settings.loadingText || 'Loading retailers...';
  const NO_RESULTS_TEXT = settings.noResultsText || 'No retailers found in this area.';
  const ERROR_LOADING_TEXT = settings.errorLoadingText || 'Error loading retailers. Please try again.';
  const LOCATION_ERROR_TEXT = settings.locationErrorText || 'Unable to get your location. Please enter a location manually.';
  const GEOLOCATION_NOT_SUPPORTED_TEXT = settings.geolocationNotSupportedText || 'Geolocation is not supported by your browser. Please enter a location manually.';
  const LOAD_MORE_TEXT = settings.loadMoreText || 'Load more retailers';
  const SHOW_DETAILS_TEXT = settings.showDetailsText || 'Show details';
  const HIDE_DETAILS_TEXT = settings.hideDetailsText || 'Hide details';
  const WEIGHTED_DISTANCE_INFO = settings.weightedDistanceInfo || 'Weighted distance factors in retailer level priority';
  const YOUR_LOCATION_TEXT = settings.yourLocationText || 'Your Location';
  const SHOWING_RETAILERS_TEXT = settings.showingRetailersText || 'Showing {x} of {y} retailers';
  const FAR_AWAY_NOTE = settings.farAwayNote || 'No retailers found nearby. Showing closest retailers.';

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
  let activeMarker = null;
  let searchAreaButton = null;
  let mapIdleTimer = null;
  let lastMapCenter = null;
  let userMovedMap = false;
  let mapAnimationInProgress = false;
  let noNearbyRetailersNote = null;

  // Data storage
  let retailers = [];
  let allRetailers = [];
  let userPosition = null;
  let userMarker = null;
  let displayedRetailerCount = 0;
  let loadMoreButton = null;
  let openDetailItem = null; // Track currently open details section

  // Local Storage Keys
  const RETAILERS_CACHE_KEY = 'retailer_finder_retailers';
  const RETAILERS_CACHE_TIMESTAMP_KEY = 'retailer_finder_retailers_timestamp';
  const CACHE_EXPIRY_MINUTES = 60; // Retailer data cache expiry time in minutes

  // SVG path for drop pin marker (standard Google Maps pin shape)
  const PIN_SVG_PATH = 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z';

  // Initialize app
  initMap();
  initAutocomplete();
  createSearchAreaButton();

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

      // Add event listeners for "Search this area" functionality
      map.addListener('dragstart', function() {
        userMovedMap = true;
        hideSearchAreaButton();
      });

      map.addListener('zoom_changed', function() {
        userMovedMap = true;
        hideSearchAreaButton();
      });

      map.addListener('idle', function() {
        if (userMovedMap) {
          // Clear existing timer
          if (mapIdleTimer) clearTimeout(mapIdleTimer);

          // Set new timer to show the button after a delay
          mapIdleTimer = setTimeout(function() {
            const currentCenter = map.getCenter();

            // Only show if center has changed significantly
            if (!lastMapCenter ||
                calculateDistance(
                  lastMapCenter.lat(), lastMapCenter.lng(),
                  currentCenter.lat(), currentCenter.lng()
                ) > 0.5) { // Half mile threshold
              showSearchAreaButton();
            }
          }, MAP_IDLE_DELAY);
        }
      });

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
        loadRetailers();
      } else {
        getUserLocation(true);
      }

    } catch (error) {
      console.error('Error initializing map:', error);
      mapElement.innerHTML = 'Error loading map. Please refresh the page.';
    }
  }

  function createNoNearbyRetailersNote() {
    // Create a note element to show when no retailers are nearby
    noNearbyRetailersNote = document.createElement('div');
    noNearbyRetailersNote.className = 'no-nearby-retailers-note';
    noNearbyRetailersNote.innerHTML = FAR_AWAY_NOTE;
    noNearbyRetailersNote.style.display = 'none';

    // Add to the DOM before the retailer list
    if (retailerList && retailerList.parentNode) {
      retailerList.parentNode.insertBefore(noNearbyRetailersNote, retailerList);
    }
  }

  function showNoNearbyRetailersNote() {
    if (!noNearbyRetailersNote) {
      createNoNearbyRetailersNote();
    }

    if (noNearbyRetailersNote) {
      noNearbyRetailersNote.style.display = 'block';
    }
  }

  function hideNoNearbyRetailersNote() {
    if (noNearbyRetailersNote) {
      noNearbyRetailersNote.style.display = 'none';
    }
  }

  function createSearchAreaButton() {
    // Create the button element
    searchAreaButton = document.createElement('div');
    searchAreaButton.className = 'search-this-area-button';
    searchAreaButton.innerHTML = SEARCH_AREA_BUTTON_TEXT;
    searchAreaButton.style.display = 'none';

    // Position it on the map
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(searchAreaButton);

    // Add click event
    searchAreaButton.addEventListener('click', function() {
      const center = map.getCenter();
      userPosition = {
        lat: center.lat(),
        lng: center.lng()
      };

      // Update last map center
      lastMapCenter = center;

      // Hide the button
      hideSearchAreaButton();

      // Add user marker at the new position
      addUserMarker(userPosition);

      // Update the search results
      if (allRetailers.length > 0) {
        updateRetailers();
        // We don't call centerMapOnSearch() here as we want to keep the current view

        // Make sure retailers are visible on the map
        ensureRetailersVisible();

        // Scroll to top of the list
        scrollListToTop();
      } else {
        loadRetailers();
      }

      // Reset user moved map flag
      userMovedMap = false;
    });
  }

  function showSearchAreaButton() {
    if (searchAreaButton) {
      searchAreaButton.style.display = 'block';
    }
  }

  function hideSearchAreaButton() {
    if (searchAreaButton) {
      searchAreaButton.style.display = 'none';
    }
  }

  function addUserMarker(position) {
    if (userMarker) {
      userMarker.setMap(null);
    }

    // Enhanced user marker with better visibility
    const userIcon = {
      path: google.maps.SymbolPath.CIRCLE,
      fillColor: USER_MARKER_COLOR,
      fillOpacity: 0.8,
      strokeColor: '#FFFFFF',
      strokeWeight: USER_MARKER_BORDER,
      scale: USER_MARKER_SCALE
    };

    userMarker = new google.maps.Marker({
      position: position,
      map: map,
      icon: userIcon,
      zIndex: 1000,
      title: YOUR_LOCATION_TEXT,
      animation: USER_MARKER_ANIMATION ? google.maps.Animation.DROP : null
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

          animateMapMove(userPosition, SEARCH_ZOOM);
          addUserMarker(userPosition);
          loadRetailers();

          // Scroll to top of the list
          scrollListToTop();
        },
        function(error) {
          console.error("Error getting location", error);
          if (silent) {
            loadRetailers();
          } else {
            retailerList.innerHTML = `<div class="no-results">${LOCATION_ERROR_TEXT}</div>`;
          }
        }
      );
    } else {
      if (!silent) {
        retailerList.innerHTML = `<div class="no-results">${GEOLOCATION_NOT_SUPPORTED_TEXT}</div>`;
      }
      loadRetailers();
    }
  }

  function handlePlaceSelection(place) {
    userPosition = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng()
    };

    saveRecentSearch(place.formatted_address, userPosition);

    // Update the map with animation
    animateMapMove(userPosition);

    // Add the user marker with animation
    addUserMarker(userPosition);

    // Store the center position
    lastMapCenter = map.getCenter();

    // Reset user moved map flag
    userMovedMap = false;

    // Hide search area button
    hideSearchAreaButton();

    if (allRetailers.length > 0) {
      updateRetailers();

      // Use the place info for initial bounds
      if (place.geometry.viewport) {
        map.fitBounds(place.geometry.viewport);
      } else {
        map.setCenter(userPosition);

        // Set zoom based on place type
        let zoomLevel = SEARCH_ZOOM;
        if (place.types && place.types.length > 0) {
          for (const type of place.types) {
            if (LOCATION_TYPE_ZOOM[type]) {
              zoomLevel = LOCATION_TYPE_ZOOM[type];
              break;
            }
          }
        }
        map.setZoom(zoomLevel);
      }

      // Ensure retailers are visible on the map
      ensureRetailersVisible();

      // Scroll to top of the list
      scrollListToTop();
    } else {
      loadRetailers();
    }
  }

  function scrollListToTop() {
    // Scroll the retailer list to the top
    if (retailerList) {
      retailerList.scrollTop = 0;
    }
  }

  function animateMapMove(position, targetZoom) {
    if (mapAnimationInProgress) return;

    mapAnimationInProgress = true;

    // If a targetZoom is specified, smoothly zoom in/out after the pan
    const currentZoom = map.getZoom();
    const needsZoomChange = (targetZoom !== undefined && targetZoom !== currentZoom);

    // Start the smooth animation to the new position
    map.panTo(position);

    // Listen for the end of the pan animation
    const panEndListener = google.maps.event.addListenerOnce(map, 'idle', function() {
      // If we need to change zoom, do it smoothly
      if (needsZoomChange) {
        smoothZoomTo(targetZoom);
      } else {
        // Animation is complete
        mapAnimationInProgress = false;
      }
    });

    // Set a timeout to prevent hanging if something goes wrong with the event
    setTimeout(function() {
      google.maps.event.removeListener(panEndListener);
      if (needsZoomChange && mapAnimationInProgress) {
        smoothZoomTo(targetZoom);
      } else {
        mapAnimationInProgress = false;
      }
    }, MAP_ANIMATION_DURATION + 200);
  }

  function smoothZoomTo(targetZoom) {
    const currentZoom = map.getZoom();

    // Same zoom, no need to animate
    if (currentZoom === targetZoom) {
      mapAnimationInProgress = false;
      return;
    }

    // Determine if we're zooming in or out
    const zoomingIn = targetZoom > currentZoom;
    const step = zoomingIn ? 1 : -1;

    // Start a timer to animate the zoom smoothly
    const perLevelDuration = MAP_ANIMATION_DURATION / Math.abs(targetZoom - currentZoom);

    function zoomStep() {
      const nextZoom = map.getZoom() + step;
      map.setZoom(nextZoom);

      if ((zoomingIn && nextZoom < targetZoom) || (!zoomingIn && nextZoom > targetZoom)) {
        setTimeout(zoomStep, perLevelDuration);
      } else {
        // Reached desired zoom level
        mapAnimationInProgress = false;
      }
    }

    // Start the zoom animation
    setTimeout(zoomStep, 100);
  }

  function ensureRetailersVisible() {
    // Skip if no retailers or no user position
    if (!userPosition || retailers.length === 0 || !ALWAYS_SHOW_RETAILERS) return;

    // Get the current map bounds
    const currentBounds = map.getBounds();

    // Count how many retailers are in the current viewport
    let retailersInView = 0;
    let closestRetailers = [];

    // Sort retailers by distance
    const sortedRetailers = [...retailers].sort((a, b) => a.distance - b.distance);

    // Take the closest ones for our calculation
    closestRetailers = sortedRetailers.slice(0, MIN_RETAILERS_TO_SHOW);

    // Count retailers in the current view
    if (currentBounds) {
      for (const marker of markers) {
        if (currentBounds.contains(marker.getPosition())) {
          retailersInView++;
        }
      }
    }

    // If we don't have enough retailers in view, adjust the map bounds
    if (retailersInView < MIN_RETAILERS_TO_SHOW) {
      // Create a new bounds object
      const newBounds = new google.maps.LatLngBounds();

      // Always include user location
      newBounds.extend(new google.maps.LatLng(userPosition.lat, userPosition.lng));

      // Add the closest retailers to the bounds
      for (const retailer of closestRetailers) {
        newBounds.extend(new google.maps.LatLng(
          parseFloat(retailer.latitude),
          parseFloat(retailer.longitude)
        ));
      }

      // Fit the map to these new bounds with padding
      map.fitBounds(newBounds, { padding: 50 });

      // If retailers are very far away, show a notification
      if (closestRetailers.length > 0 && closestRetailers[0].distance > 25) {
        showNoNearbyRetailersNote();
      } else {
        hideNoNearbyRetailersNote();
      }
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

        // Update the map with animation
        animateMapMove(userPosition);

        // Add the user marker with animation
        addUserMarker(userPosition);

        // Store the center position
        lastMapCenter = map.getCenter();

        // Reset user moved map flag
        userMovedMap = false;

        // Hide search area button
        hideSearchAreaButton();

        if (allRetailers.length > 0) {
          updateRetailers();

          // Use the search results for initial bounds
          if (results[0].geometry.viewport) {
            map.fitBounds(results[0].geometry.viewport);
          } else {
            map.setCenter(userPosition);

            // Determine zoom level based on query type
            const lowercaseQuery = query.toLowerCase();
            let zoomLevel = SEARCH_ZOOM;

            // Check for broad area terms
            if (['country', 'uk', 'england', 'scotland', 'wales', 'ireland', 'britain', 'united kingdom'].some(
              term => lowercaseQuery.includes(term))) {
              zoomLevel = LOCATION_TYPE_ZOOM.country;
            } else if (['county', 'region', 'state', 'province', 'territory', 'island'].some(
              term => lowercaseQuery.includes(term))) {
              zoomLevel = LOCATION_TYPE_ZOOM.administrative_area_level_1;
            } else if (results[0].types) {
              for (const type of results[0].types) {
                if (LOCATION_TYPE_ZOOM[type]) {
                  zoomLevel = LOCATION_TYPE_ZOOM[type];
                  break;
                }
              }
            }

            map.setZoom(zoomLevel);
          }

          // Ensure retailers are visible on the map
          ensureRetailersVisible();

          // Scroll to top of the list
          scrollListToTop();
        } else {
          loadRetailers();
        }
      } else {
        console.error('Geocode was not successful:', status);
        retailerList.innerHTML = `<div class="no-results">Location not found. Please try a different search.</div>`;
      }
    });
  }

  async function loadRetailers() {
    const cachedRetailers = getCachedRetailers();

    if (cachedRetailers) {
      allRetailers = cachedRetailers;
      console.log('Retailers loaded from cache.');
      updateRetailers();
      if (userPosition) {
        centerMapOnSearch();
      }

      // Scroll to top of the list
      scrollListToTop();

      // Refresh the cache in the background
      fetchRetailersFromAPI(true);
    } else {
      fetchRetailersFromAPI();
    }
  }

  async function fetchRetailersFromAPI(background = false) {
    try {
      if (!background) {
        retailerList.innerHTML = `<div class="retailer-finder__loading">${LOADING_TEXT}</div>`;
      }
      // Simple fetch with error handling
      const response = await fetch(API_URL);

      // Check for response errors
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      // Parse JSON safely
      const data = await response.json();

      // Validate data is an array
      if (!Array.isArray(data)) {
        throw new Error('API did not return an array of retailers');
      }

      allRetailers = data;

      if (allRetailers.length === 0) {
        retailerList.innerHTML = `<div class="no-results">${NO_RESULTS_TEXT}</div>`;
        updateCountDisplay(0, 0);
        return;
      }

      cacheRetailers(allRetailers);

      updateRetailers();
      if (userPosition) {
        centerMapOnSearch();
      }

      // Scroll to top of the list
      scrollListToTop();
    } catch (error) {
      console.error('Error fetching retailers:', error);
      retailerList.innerHTML = `<div class="retailer-finder__error">${ERROR_LOADING_TEXT}</div>`;
    }
  }

  function getCachedRetailers() {
    const cachedData = localStorage.getItem(RETAILERS_CACHE_KEY);
    const timestamp = localStorage.getItem(RETAILERS_CACHE_TIMESTAMP_KEY);

    if (!cachedData || !timestamp) {
      return null;
    }

    const expiry = CACHE_EXPIRY_MINUTES * 60 * 1000; // Convert minutes to milliseconds
    if (Date.now() - timestamp > expiry) {
      // Cache has expired
      localStorage.removeItem(RETAILERS_CACHE_KEY);
      localStorage.removeItem(RETAILERS_CACHE_TIMESTAMP_KEY);
      return null;
    }

    try {
      return JSON.parse(cachedData);
    } catch (error) {
      console.error('Error parsing cached retailers:', error);
      return null;
    }
  }

  function cacheRetailers(retailers) {
    try {
      localStorage.setItem(RETAILERS_CACHE_KEY, JSON.stringify(retailers));
      localStorage.setItem(RETAILERS_CACHE_TIMESTAMP_KEY, Date.now().toString());
      console.log('Retailers cached.');
    } catch (error) {
      console.error('Error caching retailers:', error);
    }
  }

  function centerMapOnSearch() {
    // Create a bounds that includes both the user location and nearby retailers
    if (!userPosition) return;

    // First center on the user position
    map.setCenter(userPosition);
    map.setZoom(SEARCH_ZOOM);

    // Then ensure retailers are shown
    if (retailers.length > 0) {
      ensureRetailersVisible();
    }

    // Store the center position to compare with future movements
    lastMapCenter = map.getCenter();
  }

  function updateRetailers() {
    // Clear the displayed count and reset tracking variables
    displayedRetailerCount = 0;
    openDetailItem = null;

    // Process retailers
    if (!userPosition) {
      retailers = [...allRetailers];
    } else {
      // Separate premium retailers (level 4 only) and regular retailers
      const premiumRetailers = [];
      const regularRetailers = [];

      // Calculate distance for each retailer
      allRetailers.forEach(retailer => {
        const distance = calculateDistance(
          userPosition.lat,
          userPosition.lng,
          parseFloat(retailer.latitude),
          parseFloat(retailer.longitude)
        ) * DISTANCE_MULTIPLIER;

        // Calculate weighted score using level-specific weighting
        const level = parseInt(retailer.level) || 0;
        const levelAdvantage = LEVEL_WEIGHTS[level] || 0; // Get level-specific weight or default to 0
        const weightedScore = Math.max(0, distance - levelAdvantage);

        const processedRetailer = {
          ...retailer,
          distance: distance,
          weightedScore: weightedScore,
          levelAdvantage: levelAdvantage // Store for display
        };

        // Separate premium from regular retailers
        if (PREMIUM_LEVELS.includes(level)) {
          premiumRetailers.push(processedRetailer);
        } else {
          regularRetailers.push(processedRetailer);
        }
      });

      // Sort both arrays by weighted score
      premiumRetailers.sort((a, b) => a.weightedScore - b.weightedScore);
      regularRetailers.sort((a, b) => a.weightedScore - b.weightedScore);

      // Combine: premium retailers first, then regular retailers
      retailers = [...premiumRetailers, ...regularRetailers];
    }

    // Update count display
    updateCountDisplay(0, retailers.length);

    // Display retailers and update markers
    displayRetailers();
    updateMarkers();
  }

  function updateCountDisplay(displayed, total) {
    // Update the count display with "Showing X of Y retailers"
    if (countElement) {
      const countText = SHOWING_RETAILERS_TEXT
        .replace('{x}', displayed)
        .replace('{y}', total);

      countElement.textContent = countText;
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
    // Clear existing content
    retailerList.innerHTML = '';

    if (retailers.length === 0) {
      retailerList.innerHTML = `<div class="no-results">${NO_RESULTS_TEXT}</div>`;
      return;
    }

    // For large datasets, only show the first batch initially
    const displayLimit = Math.min(INITIAL_DISPLAY_LIMIT, retailers.length);

    // Display first batch of retailers
    for (let i = 0; i < displayLimit; i++) {
      addRetailerToList(retailers[i], i);
    }

    displayedRetailerCount = displayLimit;

    // Update the count display
    updateCountDisplay(displayedRetailerCount, retailers.length);

    // Add "Load More" button if there are more retailers
    if (retailers.length > displayLimit) {
      addLoadMoreButton();
    }
  }

  function addRetailerToList(retailer, index) {
    const retailerElement = document.createElement('div');
    retailerElement.className = 'retailer-item';
    retailerElement.dataset.index = index;

    // Get the level name
    const levelName = retailer.level ? LEVEL_NAMES[retailer.level] || '' : '';
    const levelClass = retailer.level ? `level-${retailer.level}` : '';

    // Add level-specific class for styling without :has() selector
    if (retailer.level) {
      retailerElement.classList.add(`level-${retailer.level}-item`);
    }

    // Highlight premium retailers (level 4 only) in the list
    const isPremium = PREMIUM_LEVELS.includes(parseInt(retailer.level));
    if (isPremium) {
      retailerElement.classList.add('premium-retailer');
    }

    // Format distance strings - ensure both are always displayed
    const distanceText = retailer.distance !== undefined
      ? `${retailer.distance.toFixed(1)} ${DISTANCE_LABEL}`
      : '';

    const weightedText = retailer.weightedScore !== undefined
      ? `${retailer.weightedScore.toFixed(1)} ${DISTANCE_LABEL} weighted`
      : '';

    // Level advantage info for tooltip
    const levelInfo = retailer.levelAdvantage
      ? `(${retailer.levelAdvantage.toFixed(1)} ${DISTANCE_LABEL} advantage)`
      : '';

    // Create the slimline layout with accordion
    retailerElement.innerHTML = `
      <div class="retailer-header">
        <div class="retailer-main-info">
          <div class="retailer-name">
            ${levelName ? `<div class="retailer-level ${levelClass}" title="${levelName} ${levelInfo}">${levelName}</div>` : ''}
            ${retailer.name}
          </div>
          <div class="retailer-distances">
            ${distanceText ? `<span class="retailer-distance">${distanceText}</span>` : ''}
            ${weightedText ? `<span class="retailer-weighted-distance" title="${WEIGHTED_DISTANCE_INFO}">${weightedText}</span>` : ''}
          </div>
        </div>
        <button class="retailer-toggle-btn">${SHOW_DETAILS_TEXT}</button>
      </div>
      <div class="retailer-details" style="display:none">
        <div class="retailer-address">${retailer.address}, ${retailer.city}, ${retailer.postcode}</div>
        ${retailer.phone ? `<div class="retailer-phone"><strong>Tel:</strong> <a href="tel:${retailer.phone}">${retailer.phone}</a></div>` : ''}
        ${retailer.email ? `<div class="retailer-email"><strong>Email:</strong> <a href="mailto:${retailer.email}">${retailer.email}</a></div>` : ''}
        ${retailer.website ? `<div class="retailer-website"><strong>Website:</strong> <a href="${retailer.website}" target="_blank" rel="noopener">${retailer.website}</a></div>` : ''}
      </div>
    `;

    // Add event listener for the entire element (for highlighting on map)
    retailerElement.addEventListener('click', (e) => {
      // Only trigger highlightRetailer if not clicking on a link or the toggle button
      if (!e.target.closest('a') && !e.target.closest('.retailer-toggle-btn')) {
        highlightRetailer(index);
      }
    });

    // Add event listener for the toggle button
    const toggleBtn = retailerElement.querySelector('.retailer-toggle-btn');
    const detailsDiv = retailerElement.querySelector('.retailer-details');

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering the parent's click event

      const isVisible = detailsDiv.style.display !== 'none';

      // If not visible and we have a previously open one, close it
      if (!isVisible && openDetailItem && openDetailItem !== detailsDiv) {
        const parentItem = openDetailItem.closest('.retailer-item');
        if (parentItem) {
          const btn = parentItem.querySelector('.retailer-toggle-btn');
          if (btn) btn.textContent = SHOW_DETAILS_TEXT;
        }
        openDetailItem.style.display = 'none';
      }

      // Toggle this one
      detailsDiv.style.display = isVisible ? 'none' : 'block';
      toggleBtn.textContent = isVisible ? SHOW_DETAILS_TEXT : HIDE_DETAILS_TEXT;

      // Update the currently open detail item
      if (!isVisible) {
        openDetailItem = detailsDiv;
      } else if (openDetailItem === detailsDiv) {
        openDetailItem = null;
      }
    });

    retailerList.appendChild(retailerElement);
  }

  function addLoadMoreButton() {
    // Remove existing button if present
    if (loadMoreButton && loadMoreButton.parentNode) {
      loadMoreButton.parentNode.removeChild(loadMoreButton);
    }

    loadMoreButton = document.createElement('button');
    loadMoreButton.className = 'load-more-btn';
    loadMoreButton.textContent = LOAD_MORE_TEXT;

    loadMoreButton.addEventListener('click', function() {
      // Calculate next batch
      const nextBatchSize = 50; // Load 50 more at a time
      const remainingCount = retailers.length - displayedRetailerCount;
      const loadCount = Math.min(nextBatchSize, remainingCount);

      // Store reference to button parent before removing
      const buttonParent = loadMoreButton.parentNode;

      // Remove button temporarily
      if (buttonParent) {
        buttonParent.removeChild(loadMoreButton);
      }

      // Load the next batch
      for (let i = 0; i < loadCount; i++) {
        const index = displayedRetailerCount + i;
        addRetailerToList(retailers[index], index);
      }

      // Update displayed count
      displayedRetailerCount += loadCount;

      // Update the count display
      updateCountDisplay(displayedRetailerCount, retailers.length);

      // Re-add the button if there are more retailers to show
      if (displayedRetailerCount < retailers.length) {
        retailerList.appendChild(loadMoreButton);
      }
    });

    retailerList.appendChild(loadMoreButton);
  }

  function updateMarkers() {
    clearMarkers();
    bounds = new google.maps.LatLngBounds();

    if (userPosition) {
      bounds.extend(userPosition);
    }

    // Create a copy of retailers to ensure premium ones are included
    let markersToShow = [...retailers];

    // Limit the number of markers for performance with large datasets
    const markerLimit = Math.min(MAX_MARKERS, markersToShow.length);

    const newMarkers = [];

    for (let i = 0; i < markerLimit; i++) {
      const retailer = markersToShow[i];
      const position = {
        lat: parseFloat(retailer.latitude),
        lng: parseFloat(retailer.longitude)
      };

      // Determine marker for this retailer
      let markerIcon;

      // Check if custom image marker is available for this level
      if (retailer.level && MARKER_IMAGES[retailer.level]) {
        // Use custom image marker
        markerIcon = {
          url: MARKER_IMAGES[retailer.level],
          scaledSize: new google.maps.Size(
            DEFAULT_MARKER_SIZE.width,
            DEFAULT_MARKER_SIZE.height
          ),
          origin: new google.maps.Point(0, 0),
          anchor: new google.maps.Point(
            DEFAULT_MARKER_SIZE.width / 2,
            DEFAULT_MARKER_SIZE.height
          )
        };
      } else {
        // Use drop pin marker (traditional style)
        const markerColor = retailer.level && LEVEL_COLORS[retailer.level]
          ? LEVEL_COLORS[retailer.level]
          : '#FF5722'; // Default color if level is not set

        markerIcon = {
          path: PIN_SVG_PATH,
          fillColor: markerColor,
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          scale: 1.2,
          anchor: new google.maps.Point(0, 30)
        };
      }

      const marker = new google.maps.Marker({
        position: position,
        map: map,
        icon: markerIcon,
        title: retailer.name,
        optimized: true,
        retailerId: retailer.id
      });

      marker.addListener('click', () => {
        // Find the retailer's index in the original retailers array
        const originalIndex = retailers.findIndex(r => r.id === retailer.id);
        if (originalIndex !== -1) {
          highlightListItem(originalIndex);
        }
        highlightMarker(marker);

        // Smoothly pan to the marker position
        animateMapMove(marker.getPosition(), MARKER_ZOOM);
      });

      newMarkers.push(marker);
    }

    markers = newMarkers;
    clusterer.clearMarkers();
    clusterer.addMarkers(markers);

    // Always ensure user marker is on top and visible
    if (userMarker) {
      userMarker.setZIndex(1001);
    }
  }

  function highlightMarker(marker) {
    // Reset previous highlighted marker to its original state
    if (activeMarker && activeMarker !== marker) {
      resetMarkerHighlight(activeMarker);
    }

    // Store original icon to restore later
    if (!marker.originalIcon) {
      marker.originalIcon = { ...marker.getIcon() };
    }

    // Create highlighted version of icon
    let highlightedIcon;

    // Check if it's an image icon (has url) or a symbol icon (has path)
    if (marker.getIcon().url) {
      // Image icon - make slightly larger
      highlightedIcon = { ...marker.getIcon() };

      // Increase the size by 20%
      const currentSize = marker.getIcon().scaledSize;
      highlightedIcon.scaledSize = new google.maps.Size(
        currentSize.width * 1.2,
        currentSize.height * 1.2
      );

      // Adjust anchor point
      highlightedIcon.anchor = new google.maps.Point(
        currentSize.width * 1.2 / 2,
        currentSize.height * 1.2
      );

    } else {
      // Symbol icon - make it larger with thicker border
      highlightedIcon = { ...marker.getIcon() };
      highlightedIcon.scale = 1.5; // Larger size
      highlightedIcon.strokeWeight = 3; // Thicker border
    }

    // Apply highlight to marker
    marker.setIcon(highlightedIcon);
    marker.setZIndex(1000);

    // Store as active marker
    activeMarker = marker;
  }

  function resetMarkerHighlight(marker) {
    if (marker && marker.originalIcon) {
      marker.setIcon(marker.originalIcon);
      marker.setZIndex(null);
    }
  }

  function highlightListItem(index) {
    const items = retailerList.getElementsByClassName('retailer-item');
    Array.from(items).forEach(item => item.classList.remove('active'));

    // Check if the item is visible in the list
    let activeItem = retailerList.querySelector(`[data-index="${index}"]`);

    // If item isn't in the DOM yet, load more retailers until it's visible
    if (!activeItem && index < retailers.length) {
      // Load more items until we reach this index
      while (displayedRetailerCount <= index && displayedRetailerCount < retailers.length) {
        const batchSize = 20;
        const remainingCount = retailers.length - displayedRetailerCount;
        const loadCount = Math.min(batchSize, remainingCount);

        for (let i = 0; i < loadCount; i++) {
          const idx = displayedRetailerCount + i;
          addRetailerToList(retailers[idx], idx);
        }

        displayedRetailerCount += loadCount;

        // Update the count display
        updateCountDisplay(displayedRetailerCount, retailers.length);
      }

      // Try to get the item again
      activeItem = retailerList.querySelector(`[data-index="${index}"]`);
    }

    if (activeItem) {
      activeItem.classList.add('active');

      // Auto-expand the details when highlighting an item
      const detailsDiv = activeItem.querySelector('.retailer-details');
      const toggleBtn = activeItem.querySelector('.retailer-toggle-btn');

      // Close any previously open details first
      if (openDetailItem && openDetailItem !== detailsDiv) {
        const parentItem = openDetailItem.closest('.retailer-item');
        if (parentItem) {
          const btn = parentItem.querySelector('.retailer-toggle-btn');
          if (btn) btn.textContent = SHOW_DETAILS_TEXT;
        }
        openDetailItem.style.display = 'none';
      }

      // Open this item's details
      if (detailsDiv && detailsDiv.style.display === 'none') {
        detailsDiv.style.display = 'block';
        openDetailItem = detailsDiv;
        if (toggleBtn) toggleBtn.textContent = HIDE_DETAILS_TEXT;
      }

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
    activeMarker = null;
  }

  function highlightRetailer(index) {
    const marker = markers[index];
    if (marker) {
      // Highlight the marker
      highlightMarker(marker);

      // Animate to center on marker
      animateMapMove(marker.getPosition(), MARKER_ZOOM);
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

  // Save state when leaving page
  window.addEventListener('beforeunload', function() {
    saveMapState();
  });
});