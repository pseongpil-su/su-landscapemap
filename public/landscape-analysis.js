// === [수정] Vercel 배포를 위해 localhost 대신 상대 경로 사용 ===
const API_BASE_URL = '/api';

function getRegionFromAddress(address) {
    if (!address) return '기타';
    const parts = address.split(' ');
    const regionName = parts[0];
    if (regionName.includes('광주')) return '광주광역시';
    if (regionName.includes('전남')) return '전라남도';
    if (regionName.includes('전북')) return '전라북도';
    return '기타';
}

let map, geocoder;
let currentMarker = null;
let currentParcelPolygons = []; 
let currentParcelGeometry = null; 
let currentCircles = [];
let currentOverlays = [];
let currentMarkers = [];
let layersData = {};
let currentRadius = 1.0;
let contextMenuOverlay = null;
let isCadastralOn = false;
let currentAnalysisData = null;
let currentAddressInfo = null;
let chatHistory = [];

function initMap() {
    const container = document.getElementById('map');
    const options = {
        center: new kakao.maps.LatLng(35.1595, 126.8526),
        level: 7
    };
    
    map = new kakao.maps.Map(container, options);
    geocoder = new kakao.maps.services.Geocoder();
    map.setMapTypeId(kakao.maps.MapTypeId.ROADMAP);
    
    loadLayers();
    setupEventListeners();

    kakao.maps.event.addListener(map, 'rightclick', function(mouseEvent) { 
        const latLng = mouseEvent.latLng; 
        displayContextMenu(latLng);
    });

    kakao.maps.event.addListener(map, 'click', function() {
        closeContextMenu();
        // === [수정] 모바일에서 맵 클릭 시 왼쪽 패널 닫기 ===
        const leftPanel = document.getElementById('leftPanel');
        if (leftPanel) {
            leftPanel.classList.remove('open');
        }
        // === [수정] 모바일에서 맵 클릭 시 오른쪽 패널 닫기 ===
        const rightPanel = document.getElementById('rightPanel');
        if (rightPanel) {
            rightPanel.classList.remove('open', 'open-wide');
            document.querySelectorAll('.panel-toggle').forEach(t => t.classList.remove('active'));
        }
        // === [수정] 끝 ===
    });
}

function closeContextMenu() {
    if (contextMenuOverlay) {
        if (contextMenuOverlay.dragHandlers) {
            document.removeEventListener('mousemove', contextMenuOverlay.dragHandlers.onDrag);
            document.removeEventListener('mouseup', contextMenuOverlay.dragHandlers.onDragEnd);
        }
        contextMenuOverlay.setMap(null);
        contextMenuOverlay = null;
    }
}

function displayContextMenu(latLng) {
    closeContextMenu();

    const clickLat = latLng.getLat(); // 클릭한 위도
    const clickLng = latLng.getLng(); // 클릭한 경도

    geocoder.coord2Address(clickLng, clickLat, function(result, status) {
        if (status === kakao.maps.services.Status.OK) {
            const jibun = result[0].address ? result[0].address.address_name : 'N/A';
            const road = result[0].road_address ? result[0].road_address.address_name : 'N/A';
            const searchDisabled = jibun === 'N/A' ? 'disabled' : '';
            const jibunBase64 = btoa(encodeURIComponent(jibun));

            const contentDiv = document.createElement('div');
            contentDiv.className = 'context-menu';
            // === [수정] 버튼 텍스트 및 레이아웃 변경 (2차 수정) ===
            contentDiv.innerHTML = `
                <div class="context-menu-header" style="padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #eee; cursor: move; user-select: none; padding-right: 20px; position: relative;">
                    <strong>주소 정보</strong>
                    <span class="context-close" style="position: absolute; top: -2px; right: 0; cursor: pointer; font-size: 16px; color: #999;">✖</span>
                </div>
                <div><strong>지번주소</strong> ${jibun}</div>
                <div><strong>도로명</strong> ${road}</div>
                <div><strong>좌표</strong> ${clickLat.toFixed(6)}, ${clickLng.toFixed(6)}</div>
                <div style="display: flex; gap: 8px; margin-top: 12px;">
                    <button class="context-search-btn" id="contextSearchAddress" ${searchDisabled} style="flex: 1;">
                        주소 검색
                    </button>
                    <button class="context-search-btn" id="contextSearchCoord" style="flex: 1; background-color: #4CAF50;">
                        좌표 검색
                    </button>
                </div>
            `;
            // === [수정] 끝 ===

            contentDiv.querySelector('.context-close').onclick = function(e) {
                e.stopPropagation(); 
                closeContextMenu();
            };
            
            // 1. 주소로 검색 (기존)
            const searchAddressBtn = contentDiv.querySelector('#contextSearchAddress');
            if (!searchAddressBtn.disabled) {
                searchAddressBtn.onclick = function(e) {
                    e.stopPropagation(); 
                    searchFromContextMenuByAddress(jibunBase64); // 함수 이름 변경
                };
            }

            // 2. 좌표로 검색 (신규)
            const searchCoordBtn = contentDiv.querySelector('#contextSearchCoord');
            searchCoordBtn.onclick = function(e) {
                e.stopPropagation();
                // 주소(jibun)와 정확한 클릭 좌표 전달
                searchFromContextMenuByCoord(jibunBase64, clickLat, clickLng);
            };
            // === [신규] 끝 ===

            contentDiv.onmousedown = function(e) {
                e.stopPropagation();
            };

            const header = contentDiv.querySelector('.context-menu-header');
            let accumulatedX = 0;
            let accumulatedY = 0;
            let onDrag, onDragEnd;

            header.onmousedown = function(e) {
                e.preventDefault(); 
                let startX = e.clientX;
                let startY = e.clientY;

                onDrag = function(moveEvent) {
                    moveEvent.preventDefault();
                    const deltaX = moveEvent.clientX - startX;
                    const deltaY = moveEvent.clientY - startY;
                    contentDiv.style.transform = `translate(${accumulatedX + deltaX}px, ${accumulatedY + deltaY}px)`;
                }

                onDragEnd = function(upEvent) {
                    accumulatedX += (upEvent.clientX - startX);
                    accumulatedY += (upEvent.clientY - startY);
                    document.removeEventListener('mousemove', onDrag);
                    document.removeEventListener('mouseup', onDragEnd);
                    if (contextMenuOverlay) {
                        contextMenuOverlay.dragHandlers = null;
                    }
                }

                document.addEventListener('mousemove', onDrag);
                document.addEventListener('mouseup', onDragEnd);
                
                if (contextMenuOverlay) {
                     contextMenuOverlay.dragHandlers = { onDrag, onDragEnd };
                }
            };

            contextMenuOverlay = new kakao.maps.CustomOverlay({
                position: latLng, 
                content: contentDiv,
                xAnchor: 0, 
                yAnchor: 0,
                zIndex: 101
            });
            
            contextMenuOverlay.setMap(map);
        }
    });
}

// === [수정] 함수 이름 변경: searchFromContextMenu -> searchFromContextMenuByAddress ===
function searchFromContextMenuByAddress(jibunBase64) {
    closeContextMenu();
    try {
        const address = decodeURIComponent(atob(jibunBase64));
        if (address && address !== 'N/A') {
            document.getElementById('searchInput').value = address;
            executeSearch(address); // 기존 검색 (주소 기준, 중심점 분석)
        } else {
            alert('검색할 수 없는 주소입니다.');
        }
    } catch (e) {
        console.error('주소 디코딩 실패:', e);
        alert('주소 처리 중 오류가 발생했습니다.');
    }
}

// === [신규] '좌표로 검색'을 처리하는 함수 ===
async function searchFromContextMenuByCoord(jibunBase64, lat, lng) {
    closeContextMenu();
    try {
        let address = '';
        try {
            address = decodeURIComponent(atob(jibunBase64));
        } catch (e) {
            address = 'N/A'; // 디코딩 실패 시
        }

        // 주소가 N/A이더라도 좌표가 있으므로 검색 진행
        const usableAddress = (address && address !== 'N/A') 
            ? address 
            : `[좌표: ${lat.toFixed(5)}, ${lng.toFixed(5)}]`;
        
        document.getElementById('searchInput').value = usableAddress;
        
        // 좌표 기반 검색 함수 호출
        await executeSearchByCoord(lat, lng, usableAddress);

    } catch (e) {
        console.error('좌표 검색 처리 중 오류:', e);
        alert('좌표 검색 처리 중 오류가 발생했습니다.');
    }
}
// === [신규] 끝 ===


function setupEventListeners() {
    document.getElementById('radiusSlider').addEventListener('input', function(e) {
        currentRadius = parseFloat(e.target.value);
        document.getElementById('radiusValue').textContent = `${currentRadius.toFixed(1)} km`;
    });
    
    document.getElementById('searchBtn').addEventListener('click', searchAddress);
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') searchAddress();
    });

    document.getElementById('resetBtn').addEventListener('click', resetAll);
    document.getElementById('chatSendBtn').addEventListener('click', handleChatSend);
    document.getElementById('chatInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleChatSend();
        }
    });

    // === [신규] 모바일용 왼쪽 패널 토글 버튼 이벤트 리스너 ===
    const leftPanelToggle = document.querySelector('.left-panel-toggle');
    if (leftPanelToggle) {
        leftPanelToggle.addEventListener('click', function(e) {
            e.stopPropagation(); // 맵 클릭 이벤트 방지
            document.getElementById('leftPanel').classList.toggle('open');
            // 오른쪽 패널은 닫기
            document.getElementById('rightPanel').classList.remove('open', 'open-wide');
            document.querySelectorAll('.panel-toggle').forEach(t => t.classList.remove('active'));
        });
    }
    // === [신규] 끝 ===
}

function resetAll() {
    console.log('🔄 시스템 초기화');

    document.getElementById('searchInput').value = '';
    document.getElementById('radiusSlider').value = 1.0;
    document.getElementById('radiusValue').textContent = '1.0 km';
    currentRadius = 1.0;

    document.querySelectorAll('#layersSection input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
        cb.indeterminate = false;
    });

    if (currentMarker) currentMarker.setMap(null);
    currentParcelPolygons.forEach(p => p.setMap(null));
    
    closeContextMenu(); 
    
    currentCircles.forEach(circle => circle.setMap(null));
    currentOverlays.forEach(item => item.polygon.setMap(null));
    currentMarkers.forEach(item => { 
        item.marker.setMap(null); 
        item.label.setMap(null); 
    });
    
    currentMarker = null;
    currentParcelPolygons = []; 
    currentParcelGeometry = null;
    contextMenuOverlay = null;
    currentCircles = [];
    currentOverlays = [];
    currentMarkers = [];
    currentAnalysisData = null;
    currentAddressInfo = null;
    chatHistory = [];
    
    if (isCadastralOn) {
        map.removeOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT);
        isCadastralOn = false;
        const cadBtn = document.querySelector('.map-control-btn[onclick="toggleCadastralMap(this)"]');
        if (cadBtn) cadBtn.classList.remove('active');
    }
    
    document.querySelectorAll('.map-control-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.map-control-btn[onclick="changeMapType(\'ROADMAP\')"]').classList.add('active');

    const rightPanel = document.getElementById('rightPanel');
    rightPanel.classList.remove('open', 'open-wide');
    // === [수정] 모바일용 왼쪽 패널 닫기 ===
    const leftPanel = document.getElementById('leftPanel');
    leftPanel.classList.remove('open');
    // === [수정] 끝 ===
    
    document.getElementById('detailsContent').innerHTML = '<h3>📋 상세결과</h3><div class="empty-result">지점을 검색하세요.</div>';
    
    document.getElementById('chatHistory').innerHTML = `
        <div class="chat-message ai-message">
            <div class="empty-result" style="padding: 0; text-align: left; color: #555;">
                먼저 좌측에서 지번을 검색하세요.<br>
                검색이 완료되면, 이 곳에 사업 개요(예: "건축물, 20층, 50000㎡")를 입력하여 검토를 시작하세요.
            </div>
        </div>
    `;
    
    const chatInput = document.getElementById('chatInput');
    chatInput.disabled = true;
    chatInput.placeholder = '지번 검색을 먼저 완료해주세요...';
    chatInput.value = '';
    document.getElementById('chatSendBtn').disabled = true;
    
    document.getElementById('toggleDetails').classList.add('active');
    document.getElementById('toggleAI').classList.remove('active');
    document.getElementById('detailsContent').classList.add('active');
    document.getElementById('aiContent').classList.remove('active');
}

function changeMapType(type) {
    document.querySelectorAll('.base-map-btn').forEach(btn => btn.classList.remove('active'));
    let targetButton;
    if (type === 'ROADMAP') {
        map.setMapTypeId(kakao.maps.MapTypeId.ROADMAP);
        targetButton = document.querySelector('.map-control-btn[onclick="changeMapType(\'ROADMAP\')"]');
    } else if (type === 'SKYVIEW') {
        map.setMapTypeId(kakao.maps.MapTypeId.SKYVIEW);
        targetButton = document.querySelector('.map-control-btn[onclick="changeMapType(\'SKYVIEW\')"]');
    } else if (type === 'HYBRID') {
        map.setMapTypeId(kakao.maps.MapTypeId.HYBRID);
        targetButton = document.querySelector('.map-control-btn[onclick="changeMapType(\'HYBRID\')"]');
    }
    if (targetButton) targetButton.classList.add('active');
}

function toggleCadastralMap(button) {
    isCadastralOn = !isCadastralOn;
    if (isCadastralOn) {
        map.addOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT);
        button.classList.add('active');
    } else {
        map.removeOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT);
        button.classList.remove('active');
    }
}

function toggleLegend() {
    const legend = document.getElementById('circlesLegend');
    legend.classList.toggle('expanded');
    const h4 = legend.querySelector('h4');
    h4.textContent = legend.classList.contains('expanded') ? '🔍 검색 반경 ▲' : '🔍 검색 반경 ▼';
    legend.querySelector('.circle-items').style.opacity = legend.classList.contains('expanded') ? 1 : 0;
}

async function loadLayers() {
    try {
        const response = await fetch(`${API_BASE_URL}/geojson/list`);
        const result = await response.json();
        if (result.success) {
            layersData = result.data;
            console.log('📦 3계층 레이어 데이터:', layersData);
            renderLayers();
        }
    } catch (error) { console.error('레이어 목록 로드 실패:', error); }
}

function renderLayers() {
    const container = document.getElementById('layersSection');
    container.innerHTML = '';
    
    for (const [region, categories] of Object.entries(layersData)) {
        if (Object.keys(categories).length === 0) continue;

        let regionTotalExists = 0;
        let regionTotalFiles = 0;

        const regionDiv = document.createElement('div');
        regionDiv.className = 'region-container'; 

        const categoriesHtml = Object.entries(categories).map(([category, items]) => {
            if (items.length === 0) return ''; 

            const categoryExists = items.filter(item => item.exists).length;
            const categoryTotal = items.length;
            
            regionTotalExists += categoryExists;
            regionTotalFiles += categoryTotal;

            const itemsHtml = items.map(item => `
                <div class="layer-item">
                    <input type="checkbox" class="item-checkbox" 
                           id="layer-${region}-${category}-${item.name}" 
                           data-region="${region}" data-category="${category}" data-name="${item.name}" data-file="${item.file}"
                           ${!item.exists ? 'disabled' : ''}
                           onchange="toggleItemCheckbox(this)">
                    <label for="layer-${region}-${category}-${item.name}">${item.name}</label>
                    <span class="status ${item.exists ? 'exists' : ''}">${item.exists ? '사용가능' : '파일없음'}</span>
                </div>
            `).join('');

            return `
                <div class="layer-category">
                    <div class="category-header" onclick="toggleAccordion(this)">
                        <input type="checkbox" class="category-checkbox" 
                               data-region="${region}" data-category="${category}" 
                               ${categoryExists === 0 ? 'disabled' : ''}
                               onclick="event.stopPropagation(); toggleCategoryCheckbox(this)">
                        <span class="title">${category}</span>
                        <span class="count">${categoryExists}/${categoryTotal}</span>
                    </div>
                    <div class="category-items">
                        ${itemsHtml}
                    </div>
                </div>
            `;
        }).join('');

        regionDiv.innerHTML = `
            <div class="region-header" onclick="toggleAccordion(this)">
                <input type="checkbox" class="region-checkbox" 
                       data-region="${region}" 
                       ${regionTotalExists === 0 ? 'disabled' : ''}
                       onclick="event.stopPropagation(); toggleRegionCheckbox(this)">
                <span class="title">${region}</span>
                <span class="count">${regionTotalExists}/${regionTotalFiles}</span>
            </div>
            <div class="region-items">
                ${categoriesHtml}
            </div>
        `;
        container.appendChild(regionDiv);
    }
}

function toggleAccordion(header) {
    const items = header.nextElementSibling;
    items.classList.toggle('active');
}

function toggleRegionCheckbox(checkbox) {
    const region = checkbox.dataset.region;
    const isChecked = checkbox.checked;
    
    const categoryCheckboxes = document.querySelectorAll(`.category-checkbox[data-region="${region}"]`);
    categoryCheckboxes.forEach(catCb => {
        if (!catCb.disabled) {
            catCb.checked = isChecked;
            toggleCategoryCheckbox(catCb); 
        }
    });
}

function toggleCategoryCheckbox(checkbox) {
    const region = checkbox.dataset.region;
    const category = checkbox.dataset.category;
    const isChecked = checkbox.checked;

    const itemCheckboxes = document.querySelectorAll(`.item-checkbox[data-region="${region}"][data-category="${category}"]`);
    itemCheckboxes.forEach(itemCb => {
        if (!itemCb.disabled) {
            itemCb.checked = isChecked;
            toggleItemCheckbox(itemCb); 
        }
    });

    updateRegionCheckbox(region); 
}

function toggleItemCheckbox(checkbox) {
    const { region, category, file } = checkbox.dataset;
    loadGeoJSONLayer(region, category, file, checkbox.checked);
    updateCategoryCheckbox(region, category); 
}

function updateCategoryCheckbox(region, category) {
    const categoryCheckbox = document.querySelector(`.category-checkbox[data-region="${region}"][data-category="${category}"]`);
    if (!categoryCheckbox) return;

    const itemCheckboxes = document.querySelectorAll(`.item-checkbox[data-region="${region}"][data-category="${category}"]:not([disabled])`);
    const checkedCount = Array.from(itemCheckboxes).filter(cb => cb.checked).length;
    const totalCount = itemCheckboxes.length;

    if (totalCount === 0) {
        categoryCheckbox.checked = false;
        categoryCheckbox.indeterminate = false;
    } else if (checkedCount === 0) {
        categoryCheckbox.checked = false;
        categoryCheckbox.indeterminate = false;
    } else if (checkedCount === totalCount) {
        categoryCheckbox.checked = true;
        categoryCheckbox.indeterminate = false;
    } else {
        categoryCheckbox.checked = false;
        categoryCheckbox.indeterminate = true;
    }
    
    updateRegionCheckbox(region); 
}

function updateRegionCheckbox(region) {
    const regionCheckbox = document.querySelector(`.region-checkbox[data-region="${region}"]`);
    if (!regionCheckbox) return;

    const categoryCheckboxes = document.querySelectorAll(`.category-checkbox[data-region="${region}"]:not([disabled])`);
    const totalCount = categoryCheckboxes.length;
    let checkedCount = 0;
    let indeterminateCount = 0;

    categoryCheckboxes.forEach(cb => {
        if (cb.checked) checkedCount++;
        if (cb.indeterminate) indeterminateCount++;
    });

    if (totalCount === 0) {
        regionCheckbox.checked = false;
        regionCheckbox.indeterminate = false;
    } else if (indeterminateCount > 0) { 
        regionCheckbox.checked = false;
        regionCheckbox.indeterminate = true;
    } else if (checkedCount === 0) { 
        regionCheckbox.checked = false;
        regionCheckbox.indeterminate = false;
    } else if (checkedCount === totalCount) { 
        regionCheckbox.checked = true;
        regionCheckbox.indeterminate = false;
    } else { 
        regionCheckbox.checked = false;
        regionCheckbox.indeterminate = true;
    }
}

const LAYER_COLORS = {
    '경관구조': {'녹지경관': '#4caf50','산업경관': '#c95e5eff','수변경관': '#2196f3','일반시가지경관': '#ffeb3b','중심시가지경관': '#ff9800'},
    '중점경관관리구역': {'ACC': '#e9c41eff','광천사거리': '#e91e1eff','무등산녹지': '#8b8d1eff','백운광장': '#96304fff','송정역세권': '#924b1bff','영산강 및 광주천': '#1e76e9ff','원도심(광주역 일원)': '#b426b9ff'},
    '경관거점': {'공원녹지': '#4caf50','관문광장': '#9c27b0','교통시설': '#607d8b','도로기반시설': '#795548','산림': '#2e7d32','역사문화': '#ff6f00','예술산업': '#e91e63','체육여가': '#00bcd4','하천습지': '#2196f3','호수저수지': '#1976d2'},
    '2040조망점': {'가로조망점(23개소)': '#ff5722','대표조망점(8개소)': '#f44336','랜드마크(3개소)': '#9c27b0','부각조망점(15개소)': '#ff9800'},
    '경관지구': {'default': '#673ab7'}
};

async function loadGeoJSONLayer(region, category, file, show) {
    try {
        if (!show) { 
            removeLayerFromMap(region, category, file); 
            return; 
        }
        
        const url = `${API_BASE_URL}/geojson/load?region=${encodeURIComponent(region)}&category=${encodeURIComponent(category)}&file=${encodeURIComponent(file)}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (!result.success || !result.data) { 
            console.error('❌ GeoJSON 로드 실패:', result.error); 
            return; 
        }
        
        const geojson = result.data;
        if (['경관거점', '2040조망점'].includes(category)) { 
            drawPointLayer(region, category, file, geojson); 
        } else { 
            drawPolygonLayer(region, category, file, geojson); 
        }
    } catch (error) { 
        console.error('GeoJSON 로드 오류:', error); 
    }
}

function drawPointLayer(region, category, file, geojson) {
    const fileName = file.replace(/\.(geojson|json)$/, '');
    const color = LAYER_COLORS[category]?.[fileName] || LAYER_COLORS[category]?.['default'] || '#666';
    
    geojson.features.forEach((feature) => {
        if (feature.geometry.type === 'Point') {
            const [lng, lat] = feature.geometry.coordinates;
            const position = new kakao.maps.LatLng(lat, lng);
            let labelText = fileName;
            if (feature.properties) {
                if (category === '2040조망점' && feature.properties['명칭']) { labelText = feature.properties['명칭']; }
                else if (category === '경관거점' && feature.properties['거점명']) { labelText = feature.properties['거점명']; }
                else if (feature.properties.name || feature.properties.NAME) { labelText = feature.properties.name || feature.properties.NAME; }
            }
            const markerImage = new kakao.maps.MarkerImage(
                `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15,0 C6.7,0 0,6.7 0,15 C0,25 15,40 15,40 S30,25 30,15 C30,6.7 23.3,0 15,0 Z" fill="${color}" stroke="white" stroke-width="2"/><circle cx="15" cy="15" r="6" fill="white"/></svg>`)}`,
                new kakao.maps.Size(20, 40), { offset: new kakao.maps.Point(10, 35) }
            );
            const marker = new kakao.maps.Marker({ position: position, map: map, image: markerImage, zIndex: 1 });
            const labelContent = `<div style="background: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${labelText}</div>`;
            const label = new kakao.maps.CustomOverlay({ position: position, content: labelContent, yAnchor: 2.2, map: map, zIndex: 2 });
            
            currentMarkers.push({ marker, label, region, category, file });
        }
    });
}

function drawPolygonLayer(region, category, file, geojson) {
    const fileName = file.replace(/\.(geojson|json)$/, '');
    const color = LAYER_COLORS[category]?.[fileName] || LAYER_COLORS[category]?.['default'] || '#666';
    
    geojson.features.forEach(feature => {
        if (feature.geometry.type === 'Polygon') {
            const coords = feature.geometry.coordinates[0];
            const path = coords.map(coord => new kakao.maps.LatLng(coord[1], coord[0]));
            const polygon = new kakao.maps.Polygon({ map: map, path: path, strokeWeight: 2, strokeColor: color, strokeOpacity: 0.8, fillColor: color, fillOpacity: 0.2, zIndex: 0 });
            currentOverlays.push({ polygon, region, category, file });
        } else if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polyCoords => {
                const coords = polyCoords[0];
                const path = coords.map(coord => new kakao.maps.LatLng(coord[1], coord[0]));
                const polygon = new kakao.maps.Polygon({ map: map, path: path, strokeWeight: 2, strokeColor: color, strokeOpacity: 0.8, fillColor: color, fillOpacity: 0.2, zIndex: 0 });
                currentOverlays.push({ polygon, region, category, file });
            });
        }
    });
}

function removeLayerFromMap(region, category, file) {
    currentMarkers = currentMarkers.filter(item => {
        if (item.region === region && item.category === category && item.file === file) { 
            item.marker.setMap(null); 
            item.label.setMap(null); 
            return false; 
        } 
        return true;
    });
    currentOverlays = currentOverlays.filter(item => {
        if (item.region === region && item.category === category && item.file === file) { 
            item.polygon.setMap(null); 
            return false; 
        } 
        return true;
    });
}

function searchAddress() {
    const keyword = document.getElementById('searchInput').value.trim();
    if (!keyword) { 
        alert('검색어를 입력해주세요.'); 
        return; 
    }
    executeSearch(keyword); 
}

// =================================================================
// [원본] VWorld 주소 검색을 우선으로 하는 executeSearch
// =================================================================
async function executeSearch(keyword) {
    document.getElementById('loading').style.display = 'block';
    
    const chatInput = document.getElementById('chatInput');
    chatInput.disabled = true;
    chatInput.placeholder = '지번 검색을 먼저 완료해주세요...';
    document.getElementById('chatSendBtn').disabled = true;
    
    currentAnalysisData = null;
    currentAddressInfo = null;
    chatHistory = [];

    document.getElementById('chatHistory').innerHTML = `
        <div class="chat-message ai-message">
            <div class="empty-result" style="padding: 0; text-align: left; color: #555;">
                지번을 검색 중입니다...
            </div>
        </div>
    `;

    // --- Step 1: VWorld API로 주소 우선 검색 ---
    try {
        console.log(`🔍 1단계: VWorld 주소 검색 (${keyword})`);
        const response = await fetch(`${API_BASE_URL}/search/address`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: keyword })
        });
        const result = await response.json();

        if (result.success) {
            console.log('✅ VWorld 검색 성공. VWorld 데이터로 분석합니다.');
            // VWorld가 좌표, 주소, 경계를 모두 반환
            // === [수정] useExactCoords 플래그로 false 전달 (중심점 사용) ===
            await displaySearchResult(result.lat, result.lng, result.address, result.geometry, false);
            return; // 성공했으므로 종료
        } else {
            // VWorld 검색 실패 시 Kakao로 Fallback
            console.warn(`⚠️ VWorld 검색 실패 (${result.error}). Kakao로 2단계 검색을 시도합니다.`);
            executeKakaoSearch(keyword);
        }
    } catch (error) {
        console.error(`❌ VWorld API 호출 오류: ${error.message}. Kakao로 2단계 검색을 시도합니다.`);
        executeKakaoSearch(keyword);
    }
}

// --- Step 2: VWorld 실패 시 Kakao API로 검색 (기존 로직) ---
function executeKakaoSearch(keyword) {
    console.log(`🔍 2단계: Kakao 주소 검색 (${keyword})`);
    geocoder.addressSearch(keyword, async function(result, status) {
        if (status === kakao.maps.services.Status.OK) { 
            await handleKakaoSearchResult(result[0]); 
        } else {
            // Kakao 주소 검색 실패 시 Kakao 장소 검색
            console.warn('⚠️ Kakao 주소 검색 실패. Kakao 장소 검색을 시도합니다.');
            const ps = new kakao.maps.services.Places();
            ps.keywordSearch(keyword, async function(data, status) {
                if (status === kakao.maps.services.Status.OK && data.length > 0) { 
                    await handleKakaoPlaceResult(data[0]); 
                } else { 
                    // 모든 검색 실패
                    document.getElementById('loading').style.display = 'none'; 
                    alert('검색 결과가 없습니다. 정확한 주소를 입력해주세요.'); 
                    document.getElementById('chatHistory').innerHTML = `
                        <div class="chat-message ai-message">
                            <div class="empty-result" style="padding: 0; text-align: left; color: #555;">
                                검색 결과가 없습니다.
                            </div>
                        </div>
                    `;
                }
            });
        }
    });
}

// Kakao 주소 검색 결과 처리
async function handleKakaoSearchResult(result) {
    const lat = parseFloat(result.y);
    const lng = parseFloat(result.x);
    const address = result.address_name || result.address?.address_name;
    
    // ⬇️ [추가] Kakao 좌표 유효성 검사 (NaN, Infinity 체크)
    if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
        console.error(`❌ Kakao API가 유효하지 않은 좌표를 반환했습니다: ${result.y}, ${result.x}`);
        document.getElementById('loading').style.display = 'none';
        alert('Kakao에서 유효하지 않은 좌표를 반환하여 검색을 중단합니다.');
        return;
    }

    // Kakao가 반환한 좌표로 VWorld 필지 경계를 조회
    const geometry = await fetchParcelBoundary(lat, lng);
    // === [수정] useExactCoords 플래그로 false 전달 (중심점 사용) ===
    await displaySearchResult(lat, lng, address, geometry, false);
}

// Kakao 장소 검색 결과 처리
async function handleKakaoPlaceResult(place) {
    const lat = parseFloat(place.y);
    const lng = parseFloat(place.x);
    
    // ⬇️ [추가] Kakao 좌표 유효성 검사 (NaN, Infinity 체크)
    if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
        console.error(`❌ Kakao API가 유효하지 않은 장소 좌표를 반환했습니다: ${place.y}, ${place.x}`);
        document.getElementById('loading').style.display = 'none';
        alert('Kakao에서 유효하지 않은 장소 좌표를 반환하여 검색을 중단합니다.');
        return;
    }

    // 장소의 좌표로 VWorld 필지 경계를 조회
    const geometry = await fetchParcelBoundary(lat, lng);

    // 장소의 좌표로 카카오에서 지번 주소를 다시 조회
    geocoder.coord2Address(lng, lat, async function(results, status) {
        let address = place.address_name || place.place_name;
        if (status === kakao.maps.services.Status.OK && results[0]) { 
            address = results[0].address.address_name; 
        }
        // === [수정] useExactCoords 플래그로 false 전달 (중심점 사용) ===
        await displaySearchResult(lat, lng, address, geometry, false);
    });
}
// =================================================================
// ⬆️ 검색 로직 종료 ⬆️
// =================================================================


// === [신규] '좌표로 검색' 실행 함수 ===
async function executeSearchByCoord(lat, lng, address) {
    console.log(`🔍 좌표 기반 검색 시작: ${lat}, ${lng} (주소: ${address})`);
    document.getElementById('loading').style.display = 'block';

    // Reset chat and analysis state
    const chatInput = document.getElementById('chatInput');
    chatInput.disabled = true;
    chatInput.placeholder = '지번 검색을 먼저 완료해주세요...';
    document.getElementById('chatSendBtn').disabled = true;
    
    currentAnalysisData = null;
    currentAddressInfo = null;
    chatHistory = [];

    document.getElementById('chatHistory').innerHTML = `
        <div class="chat-message ai-message">
            <div class="empty-result" style="padding: 0; text-align: left; color: #555;">
                좌표 기반 검색 중입니다...
            </div>
        </div>
    `;

    // Step 1: Fetch parcel boundary using the coordinates
    // fetchParcelBoundary는 좌표로 필지 경계를 잘 찾아옵니다.
    const geometry = await fetchParcelBoundary(lat, lng);

    // Step 2: Display results, forcing the use of exact coordinates
    // === [수정] useExactCoords 플래그로 true 전달 (클릭 지점 사용) ===
    await displaySearchResult(lat, lng, address, geometry, true);
}
// === [신규] 끝 ===


// =================================================================
// ⬇️ [수정] displaySearchResult (좌표 유효범위 체크 + useExactCoords 플래그) ⬇️
// =================================================================
// === [수정] 5번째 파라미터로 useExactCoords 추가 ===
async function displaySearchResult(lat, lng, address, geometry = null, useExactCoords = false) {
    
    // === [수정] 모바일 패널 닫기 ===
    document.getElementById('leftPanel').classList.remove('open');
    document.getElementById('rightPanel').classList.remove('open', 'open-wide');
    // === [수정] 끝 ===

    if (currentMarker) currentMarker.setMap(null);
    currentParcelPolygons.forEach(p => p.setMap(null));
    currentParcelPolygons = [];
    currentParcelGeometry = null;

    let centerLat = lat;
    let centerLng = lng;

    // Step 1: 필지 경계(geometry) 그리기
    if (geometry) {
        try {
            currentParcelGeometry = geometry;
            const bounds = new kakao.maps.LatLngBounds(); 

            // 공통 폴리곤 스타일
            const polygonStyle = {
                strokeWeight: 4,
                strokeColor: '#FF3B3B',
                strokeOpacity: 1,
                strokeStyle: 'solid',
                fillColor: '#FF6B6B',
                fillOpacity: 0.35,
                zIndex: 3
            };
            
            // Null, NaN, Infinity 및 유효범위(Lat/Lng)까지 체크하는 헬퍼 함수
            const filterAndCreatePath = (coords) => {
                if (!Array.isArray(coords)) return [];
                return coords
                    .filter(coord => {
                        if (!coord || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
                            return false; // 기본 타입 체크
                        }
                        
                        const lng = coord[0];
                        const lat = coord[1];
                        
                        // NaN, Infinity 체크
                        if (!isFinite(lng) || !isFinite(lat)) {
                            return false; 
                        }
                        
                        // 위도/경도 유효 범위 체크
                        if (lat < -90 || lat > 90) {
                            console.warn('⚠️ 유효하지 않은 위도(Latitude) 값 필터링:', lat);
                            return false;
                        }
                        if (lng < -180 || lng > 180) {
                            console.warn('⚠️ 유효하지 않은 경도(Longitude) 값 필터링:', lng);
                            return false;
                        }
                        
                        return true; // 모든 검사 통과
                    })
                    .map(coord => new kakao.maps.LatLng(coord[1], coord[0]));
            };

            // Polygon 처리 (좌표 유효성 검사 적용)
            if (geometry.type === 'Polygon') {
                if (Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0])) {
                    const coords = geometry.coordinates[0]; // outer ring
                    const path = filterAndCreatePath(coords);
                    
                    if (path.length > 0) {
                        const polygon = new kakao.maps.Polygon({
                            map: map,
                            path: path,
                            ...polygonStyle
                        });
                        currentParcelPolygons.push(polygon);
                        path.forEach(point => bounds.extend(point));
                    } else {
                        console.warn('⚠️ Polygon 데이터가 유효하지 않아 그리지 못했습니다.');
                    }
                } else {
                    console.warn('⚠️ Polygon 지오메트리 좌표 데이터가 비어있습니다.');
                }

            // MultiPolygon 처리
            } else if (geometry.type === 'MultiPolygon') {
                if (Array.isArray(geometry.coordinates)) {
                    geometry.coordinates.forEach(polygonCoords => {
                        if (Array.isArray(polygonCoords) && Array.isArray(polygonCoords[0])) {
                            const coords = polygonCoords[0]; // outer ring
                            const path = filterAndCreatePath(coords);

                            if (path.length > 0) {
                                const polygon = new kakao.maps.Polygon({
                                    map: map,
                                    path: path,
                                    ...polygonStyle
                                });
                                currentParcelPolygons.push(polygon);
                                path.forEach(point => bounds.extend(point));
                            } else {
                                console.warn('⚠️ MultiPolygon 내부 폴리곤이 유효하지 않습니다.');
                            }
                        }
                    });
                } else {
                     console.warn('⚠️ MultiPolygon 지오메트리 좌표 데이터가 비어있습니다.');
                }
            }
            
            // === useExactCoords 플래그에 따라 중심점(centerLat/Lng) 분기 처리 ===
            if (currentParcelPolygons.length > 0) {
                // 경계가 그려졌는지, 유효한지 확인
                if (bounds.isEmpty()) {
                    console.warn('⚠️ Bounds가 비어있습니다. 원본 좌표를 중심으로 사용합니다.');
                    map.setCenter(new kakao.maps.LatLng(lat, lng));
                    map.setLevel(5);
                } else if (useExactCoords) {
                    // '이 좌표로 검색' 클릭 시: 클릭 좌표 유지, 지도는 경계에 맞게 확대
                    centerLat = lat;
                    centerLng = lng;
                    console.log('✅ 분석 기준점: 클릭 좌표 사용');
                    map.setBounds(bounds);
                } else {
                    // 일반 검색: 필지 중심점으로 분석 기준을 잡고 확대
                    const center = bounds.getCenter();
                    if (center) { 
                        centerLat = center.getLat();
                        centerLng = center.getLng();
                        console.log('✅ 분석 기준점: 필지 중심점 사용');
                    }
                    map.setBounds(bounds);
                }
            } else {
                // 유효한 폴리곤이 없으면 원래 좌표로 중심 이동
                map.setCenter(new kakao.maps.LatLng(lat, lng));
                map.setLevel(5);
            }
            // === 블록 끝 ===

        } catch (e) {
            console.error('❌ 필지 경계 그리기 오류:', e);
            // 경계 그리기에 실패해도 마커와 원은 원래 좌표(lat, lng)로 계속 진행
            map.setCenter(new kakao.maps.LatLng(lat, lng));
            map.setLevel(5);
        }
    } else {
        // 경계가 없으면 원래 좌표로 맵 중심 이동
        console.warn('⚠️ 필지 경계(geometry) 데이터 없이 검색 결과를 표시합니다.');
        map.setCenter(new kakao.maps.LatLng(lat, lng));
        map.setLevel(5);
    }

    
    // Step 2: 마커 및 원 그리기 (위 로직에서 결정된 centerLat, centerLng 사용)
    const centerCoords = new kakao.maps.LatLng(centerLat, centerLng);
    currentMarker = new kakao.maps.Marker({ map: map, position: centerCoords, title: address, zIndex: 10 });
    drawCircles(centerLat, centerLng);
    
    // Step 3: 분석 수행 (위 로직에서 결정된 centerLat, centerLng 사용)
    const detectedRegion = getRegionFromAddress(address);
    // 상세결과에 표시될 lat, lng는 분석 기준점이 된 centerLat/Lng를 사용
    await analyzeLocation(centerLat, centerLng, address, detectedRegion); 
    
    document.getElementById('loading').style.display = 'none';
    console.log(`✅ 검색 완료: ${address} (분석 좌표: ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)})`);
}
// =================================================================
// ⬆️ [수정] displaySearchResult 종료 ⬆️
// =================================================================


// =================================================================
// [원본] fetchParcelBoundary (Kakao Fallback용)
// =================================================================
async function fetchParcelBoundary(lat, lng) {
    try {
        const response = await fetch(`${API_BASE_URL}/parcel?lat=${lat}&lng=${lng}`);
        const data = await response.json();
        
        if (data.success && data.geometry) {
            return data.geometry; // 경계 데이터 반환
        } else { 
            console.warn('⚠️ (Fallback) 필지 데이터 없음:', data.message); 
            return null;
        }
    } catch (error) { 
        console.error('❌ (Fallback) 필지 경계 가져오기 오류:', error); 
        return null;
    }
}
// =================================================================
// ⬆️ fetchParcelBoundary 종료 ⬆️
// =================================================================


function drawCircles(lat, lng) {
    currentCircles.forEach(circle => circle.setMap(null));
    currentCircles = [];
    const center = new kakao.maps.LatLng(lat, lng);
    const radii = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const colors = ['#ff6b6b', '#ffa726', '#ffeb3b', '#66bb6a', '#42a5f5', '#ab47bc'];
    radii.forEach((radius, index) => {
        if (radius <= currentRadius) {
            const circle = new kakao.maps.Circle({ center: center, radius: radius * 1000, strokeWeight: 2.5, strokeColor: colors[index], strokeOpacity: 1.0, strokeStyle: 'dashed', fillColor: colors[index], fillOpacity: 0.05, zIndex: 0 });
            circle.setMap(map);
            currentCircles.push(circle);
        }
    });
}

async function analyzeLocation(lat, lng, address, detectedRegion) {
    try {
        // [수정 시작]
        // 기존의 layersData를 순회하는 대신,
        // 실제 '체크된' 체크박스만 찾아서 selectedLayers 객체를 만듭니다.
        const selectedLayers = {};
        const checkedItems = document.querySelectorAll('.item-checkbox:checked');
        
        checkedItems.forEach(cb => {
            // dataset에서 region, category, name, file 정보를 가져옵니다.
            const { region, category, name, file } = cb.dataset;
            
            if (!selectedLayers[region]) {
                selectedLayers[region] = {};
            }
            if (!selectedLayers[region][category]) {
                selectedLayers[region][category] = [];
            }
            
            // 서버가 요구하는 형식(이름, 파일)으로 추가합니다.
            selectedLayers[region][category].push({
                name: name,
                file: file
            });
        });

        const response = await fetch(`${API_BASE_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                lat, 
                lng, 
                layers: selectedLayers, 
                radius: currentRadius,
                parcelGeometry: currentParcelGeometry // (displaySearchResult에서 설정된 전역 변수 사용)
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentAnalysisData = { 
                overlap: result.data.overlap, 
                nearby: result.data.nearby 
            };
            currentAddressInfo = { 
                address: address, 
                region: detectedRegion,
                lat: lat, // 분석에 실제 사용된 lat
                lng: lng  // 분석에 실제 사용된 lng
            };
            
            const chatInput = document.getElementById('chatInput');
            chatInput.disabled = false;
            chatInput.placeholder = '사업 개요 (유형, 규모, 면적 등)를 입력하세요...';
            document.getElementById('chatSendBtn').disabled = false;

            const chatHistoryDiv = document.getElementById('chatHistory');
            chatHistoryDiv.innerHTML = '';

            const welcomeMessage = `안녕하세요! AI 경관 검토관입니다.
대상지 <strong>[${currentAddressInfo.address}]</strong>에 대한 기본 분석이 완료되었습니다.

검토를 시작하려면 이 곳에 <strong>사업 개요</strong>를 입력해주세요.
AI가 심의 대상을 판단할 수 있도록 아래 예시를 참고하여 <strong>유형, 규모, 면적, 비용</strong> 등을 포함해주세요.

<strong>예시:</strong>
- <strong>건축물:</strong> "20층, 연면적 50000㎡ 건축물 신축"
- <strong>개발사업:</strong> "도시개발사업, 사업 면적 35000㎡"
- <strong>기반시설:</strong> "도로사업, 총사업비 600억원"
`;
            addMessageToChat(welcomeMessage, 'ai');

            // === [수정] 상세 결과 표시에 분석에 사용된 lat, lng 전달 ===
            await displayAnalysisResult(result.data, address, lat, lng, detectedRegion);
        }
    } catch (error) {
        console.error('분석 오류:', error);
    }
}

async function displayAnalysisResult(data, address, lat, lng, detectedRegion) {
    const detailsContent = document.getElementById('detailsContent');
    
    // === [수정] 상세결과에 표시되는 좌표는 분석에 실제 사용된 lat, lng ===
    let detailsHtml = `
        <h3>📋 상세결과</h3>
        <div class="result-section">
            <h4>📍 대상지 정보</h4>
            <div class="result-item">
                <strong>${address}</strong>
                <div class="distance">분석 좌표: ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                <div class="distance">검색 반경: ${currentRadius}km</div>
                <div class="distance" style="color: #3f51b5; font-weight: bold;">감지된 지역: ${detectedRegion}</div>
            </div>
        </div>
        
        <div class="analysis-group">
            <h4 class="overlap-bar">면 레이어 (포함)</h4>
            <ul>
    `;

    const overlapCategories = ['경관구조', '중점경관관리구역', '경관지구'];
    let hasOverlap = false;

    overlapCategories.forEach(category => {
        const items = data.overlap?.[category] || [];
        if (items.length > 0) {
            hasOverlap = true;
            const itemDetails = items.map(item => `${item.name} (${item.region})`).join(', ');
            detailsHtml += `<li><strong>${category}</strong> ${itemDetails}</li>`;
        }
    });

    if (!hasOverlap) {
        detailsHtml += `<li class="none">포함된 면 레이어 없음</li>`;
    }
    detailsHtml += `</ul>`;

    detailsHtml += `<h4 class="nearby-bar">점 레이어 (반경 ${currentRadius}km 내)</h4><ul>`;
    
    const nearbyCategories = ['경관거점', '2040조망점'];
    let hasNearby = false;

    nearbyCategories.forEach(category => {
        const items = data.nearby?.[category] || [];
        if (items.length > 0) {
            hasNearby = true;
            detailsHtml += `<li><strong>${category}</strong></li><ul>`; 
            items.sort((a, b) => a.distance - b.distance); 
            items.forEach(item => {
                const displayName = item.actualName || item.name;
                detailsHtml += `<li>${displayName} (${item.region}) (거리: ${item.distance}km)</li>`;
            });
            detailsHtml += `</ul>`;
        }
    });

    if (!hasNearby) {
        detailsHtml += `<li class="none">반경 내 점 레이어 없음</li>`;
    }
    
    detailsHtml += `</ul></div>`;
    detailsContent.innerHTML = detailsHtml;

    // ⬇️ [수정] 검색 시 항상 '상세결과' 탭이 열리도록 강제
    showRightPanelTab('details', true);
}

function addMessageToChat(message, type, id = null) {
    const chatHistoryDiv = document.getElementById('chatHistory');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}-message`;
    
    if (id) {
        messageDiv.id = id;
    }

    messageDiv.innerHTML = formatAiResponse(message);

    chatHistoryDiv.appendChild(messageDiv);
    chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight;
    return messageDiv;
}

function formatAiResponse(text) {
    let html = text;
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^- (.*$)/gim, '<ul><li>$1</li></ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br><ul>/g, '<ul>');
    html = html.replace(/<\/ul><br>/g, '</ul>');
    return html;
}

async function handleChatSend() {
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');
    const userMessage = chatInput.value.trim();

    if (!userMessage) return;

    addMessageToChat(userMessage, 'user');
    chatInput.value = '';

    chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });

    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    const loadingDiv = addMessageToChat('AI가 응답을 생성 중입니다... (잠시 기다려주세요)', 'ai', 'ai-loading');

    try {
        let endpoint = '';
        let payload = {};

        if (chatHistory.length === 1) { 
            // 1. 최초 분석 요청
            endpoint = '/gemini/analyze_chat';
            payload = { 
                overlap: currentAnalysisData.overlap,
                nearby: currentAnalysisData.nearby,
                address: currentAddressInfo.address,
                region: currentAddressInfo.region,
                lat: currentAddressInfo.lat, // 분석에 사용된 좌표 전달
                lng: currentAddressInfo.lng, // 분석에 사용된 좌표 전달
                projectInfoText: userMessage 
            };
        } else {
            // 2. 후속 채팅 요청 (대화 연속성 수정 반영)
            endpoint = '/gemini/chat';
            payload = { 
                history: chatHistory,
                analysisContext: {
                    overlap: currentAnalysisData.overlap,
                    nearby: currentAnalysisData.nearby,
                    address: currentAddressInfo.address,
                    region: currentAddressInfo.region,
                    lat: currentAddressInfo.lat, // 분석에 사용된 좌표 전달
                    lng: currentAddressInfo.lng  // 분석에 사용된 좌표 전달
                }
            };
        }

        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            const aiResponse = result.response;
            loadingDiv.innerHTML = formatAiResponse(aiResponse);
            loadingDiv.id = '';
            
            chatHistory.push({ role: 'model', parts: [{ text: aiResponse }] });
        } else {
            const errorMsg = `오류가 발생했습니다: ${result.error || '응답을 가져오지 못했습니다.'}`;
            loadingDiv.innerHTML = formatAiResponse(errorMsg);
            loadingDiv.id = '';
            
            chatHistory.push({ role: 'model', parts: [{ text: errorMsg }] });
        }

    } catch (error) {
        console.error('Gemini 채팅 오류:', error);
        const errorMsg = '채팅 서버 연결에 실패했습니다.';
        loadingDiv.innerHTML = formatAiResponse(errorMsg);
        loadingDiv.id = '';
        
        chatHistory.push({ role: 'model', parts: [{ text: errorMsg }] });
    }

    chatInput.disabled = false;
    chatSendBtn.disabled = false;
    chatInput.focus();
}

// ⬇️ [수정] showRightPanelTab 함수에 forceOpen 파라미터 추가 및 모바일 로직 추가
function showRightPanelTab(tabName, forceOpen = false) {
    const panel = document.getElementById('rightPanel');
    const targetTab = document.getElementById(tabName === 'details' ? 'toggleDetails' : 'toggleAI');
    const isAlreadyActive = targetTab.classList.contains('active');
    const isPanelOpen = panel.classList.contains('open') || panel.classList.contains('open-wide');

    // === [수정] 모바일에서 왼쪽 패널 닫기 ===
    document.getElementById('leftPanel').classList.remove('open');
    // === [수정] 끝 ===

    // ⬇️ [수정] forceOpen이 true가 아닐 때만 토글 로직 실행
    if (!forceOpen && isAlreadyActive && isPanelOpen) {
        panel.classList.remove('open', 'open-wide');
        targetTab.classList.remove('active'); 
        return;
    }

    document.querySelectorAll('.panel-toggle').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));

    if (tabName === 'details') {
        panel.classList.add('open');
        panel.classList.remove('open-wide');
        document.getElementById('toggleDetails').classList.add('active');
        document.getElementById('detailsContent').classList.add('active');
    } else if (tabName === 'ai') {
        panel.classList.add('open');
        // 모바일에서는 open-wide를 강제로 적용하지 않도록 index.html의 CSS에서 처리
        panel.classList.add('open-wide'); 
        document.getElementById('toggleAI').classList.add('active');
        document.getElementById('aiContent').classList.add('active');
    }
}

window.onload = initMap;

