// [수정된 server.js 파일 전체]

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.static('public'));
app.use(express.json());

require('dotenv').config();

// === API 키 로드 ===
const VWORLD_API_KEY = process.env.VWORLD_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VWORLD_DOMAIN = process.env.VWORLD_DOMAIN; // Vercel 환경변수에서 도메인 로드

const GEOJSON_DIR = path.join(process.cwd(), 'geojson');

// === [수정] 데이터 캐싱을 위한 전역 변수 ===
let lawData = null; 
let geojsonListData = {}; // /api/geojson/list 응답 캐시
let geojsonDataCache = {}; // /api/geojson/load 응답 캐시

// === 법규 데이터 로드 함수 ===
async function loadLawData() {
    try {
        const lawJsonPath = path.join(process.cwd(), 'law.json');
        const data = await fs.readFile(lawJsonPath, 'utf8');
        lawData = JSON.parse(data);
        console.log('✅ law.json 로드 성공');
    } catch (err) {
        console.error('❌ law.json 로드 실패:', err.message);
    }
}

// === [신규] 모든 GeoJSON 파일을 메모리로 로드하는 함수 ===
async function loadAllGeojsonFiles() {
    console.log('🔄 모든 GeoJSON 파일 로드를 시작합니다...');
    const newGeojsonListData = {};
    const newGeojsonDataCache = {};

    try {
        const regions = (await fs.readdir(GEOJSON_DIR, { withFileTypes: true }))
            .filter(dir => dir.isDirectory())
            .map(dir => dir.name);

        for (const region of regions) {
            newGeojsonListData[region] = {};
            newGeojsonDataCache[region] = {};
            const regionPath = path.join(GEOJSON_DIR, region);
            
            try {
                const categories = (await fs.readdir(regionPath, { withFileTypes: true }))
                    .filter(dir => dir.isDirectory())
                    .map(dir => dir.name);
                
                for (const category of categories) {
                    newGeojsonListData[region][category] = [];
                    newGeojsonDataCache[region][category] = {};
                    const categoryPath = path.join(regionPath, category);
                    
                    try {
                        const files = (await fs.readdir(categoryPath))
                            .filter(f => f.endsWith('.geojson') || f.endsWith('.json'));
                        
                        for (const file of files) {
                            const name = file.replace(/\.(geojson|json)$/, '');
                            
                            // 1. List 데이터 추가
                            newGeojsonListData[region][category].push({
                                name: name,
                                file: file,
                                exists: true
                            });

                            // 2. 실제 GeoJSON 파일 읽고 파싱해서 캐시
                            try {
                                const filePath = path.join(categoryPath, file);
                                const fileData = await fs.readFile(filePath, 'utf8');
                                newGeojsonDataCache[region][category][file] = JSON.parse(fileData);
                            } catch (readErr) {
                                console.error(`❌ ${filePath} 파일 읽기/파싱 실패:`, readErr.message);
                                // List에서는 존재하지만 실제 데이터는 없는 경우
                                newGeojsonListData[region][category].find(f => f.file === file).exists = false;
                            }
                        }
                    } catch (err) {
                        console.warn(`⚠️ ${categoryPath} 읽기 실패:`, err.message);
                    }
                }
            } catch (err) {
                console.warn(`⚠️ ${regionPath} 읽기 실패:`, err.message);
            }
        }
        
        // 전역 변수에 할당
        geojsonListData = newGeojsonListData;
        geojsonDataCache = newGeojsonDataCache;
        console.log('✅ 모든 GeoJSON 파일 메모리 로드 및 캐시 완료.');

    } catch (error) {
        console.error('❌ GeoJSON 파일 전체 로드 실패:', error);
    }
}
// === [신규] 함수 종료 ===


// =================================================================
// [수정] GeoJSON List API (메모리 캐시 사용)
// =================================================================
app.get('/api/geojson/list', async (req, res) => {
    // [수정] 파일 시스템을 읽는 대신 캐시된 geojsonListData를 즉시 반환
    if (Object.keys(geojsonListData).length === 0) {
        // Vercel 콜드 스타트 직후 캐시가 비어있을 수 있으므로 재생성
        console.warn('⚠️ GeoJSON List 캐시가 비어있습니다. 재생성합니다.');
        await loadAllGeojsonFiles();
    }
    res.json({ success: true, data: geojsonListData });
});

// =================================================================
// [수정] GeoJSON Load API (메모리 캐시 사용)
// =================================================================
app.get('/api/geojson/load', async (req, res) => {
    try {
        const { region, category, file } = req.query;
        if (!region || !category || !file) {
            return res.status(400).json({ success: false, error: '지역, 카테고리 또는 파일 이름이 없습니다.' });
        }
        
        // [수정] 파일 시스템을 읽는 대신 캐시된 geojsonDataCache에서 데이터 조회
        const cachedData = geojsonDataCache[region]?.[category]?.[file];
        
        if (cachedData) {
            res.json({ success: true, data: cachedData });
        } else {
            console.error(`❌ GeoJSON 캐시 없음: ${region}/${category}/${file}`);
            // 캐시가 비었으면 동기화 (비상시)
            if (Object.keys(geojsonDataCache).length === 0) {
                 await loadAllGeojsonFiles();
                 const retryData = geojsonDataCache[region]?.[category]?.[file];
                 if (retryData) return res.json({ success: true, data: retryData });
            }
            res.json({ success: false, error: '해당 GeoJSON 데이터를 찾을 수 없습니다.' });
        }
    } catch (error) {
        console.error('❌ GeoJSON 로드 오류:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// =================================================================
// [Original Feature] Utility Functions (pointInPolygon, getDistance)
// (수정 없음)
// =================================================================
function pointInPolygon(point, polygon) {
    const [x, y] = point;
    if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) return false; 
    let inside = false;
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        if (!Array.isArray(polygon[i]) || polygon[i].length < 2 || !Array.isArray(polygon[j]) || polygon[j].length < 2) continue;
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        if (isNaN(xi) || isNaN(yi) || isNaN(xj) || isNaN(yj) || !isFinite(xi) || !isFinite(yi) || !isFinite(xj) || !isFinite(yj)) continue;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// =================================================================
// [수정] Core Analysis API (/api/analyze) (메모리 캐시 사용)
// =================================================================
app.post('/api/analyze', async (req, res) => {
    try {
        const { lat, lng, layers, radius = 3.0, parcelGeometry } = req.body;
        console.log(`\n🔍 경관 분석 시작: ${lat}, ${lng}, 반경: ${radius}km`);

        // [수정] 캐시가 비었으면 재생성
        if (Object.keys(geojsonDataCache).length === 0) {
            console.warn('⚠️ 분석 API: GeoJSON 캐시가 비어있습니다. 재생성합니다.');
            await loadAllGeojsonFiles();
        }

        const results = {
            overlap: {},
            nearby: {}
        };
        const point = [lng, lat];

        let parcelPolygons = [];
        if (parcelGeometry) {
            if (parcelGeometry.type === 'Polygon') {
                parcelPolygons.push(parcelGeometry.coordinates[0]);
            } else if (parcelGeometry.type === 'MultiPolygon') {
                parcelGeometry.coordinates.forEach(poly => {
                    parcelPolygons.push(poly[0]);
                });
            }
        }

        for (const [region, categories] of Object.entries(layers)) {
            for (const [category, items] of Object.entries(categories)) {
                
                if (!items || items.length === 0) continue;

                if (!results.overlap[category]) results.overlap[category] = [];
                if (!results.nearby[category]) results.nearby[category] = [];

                for (const item of items) {
                    try {
                        // === [수정] fs.readFile 대신 캐시에서 geojson 데이터 로드 ===
                        const geojson = geojsonDataCache[region]?.[category]?.[item.file];
                        
                        if (!geojson) {
                             console.log(`⚠️ ${region}/${category}/${item.file} 캐시 없음, 건너뜁니다.`);
                             continue; // 캐시에 없으면 건너뛰기
                        }
                        // ================================================

                        let isOverlapping = false;

                        if (['경관구조', '중점경관관리구역', '경관지구'].includes(category)) {
                            for (const feature of geojson.features) {
                                if (isOverlapping) break;
                                const geom = feature.geometry;
                                let featurePolygons = [];
                                if (geom.type === 'Polygon') {
                                    featurePolygons.push(geom.coordinates[0]);
                                } else if (geom.type === 'MultiPolygon') {
                                    geom.coordinates.forEach(polyCoords => {
                                        featurePolygons.push(polyCoords[0]);
                                    });
                                }
                                for (const featureCoords of featurePolygons) {
                                    if (isOverlapping) break;
                                    if (pointInPolygon(point, featureCoords)) {
                                        isOverlapping = true;
                                        break;
                                    }
                                    if (parcelPolygons.length > 0) {
                                        for (const parcelCoords of parcelPolygons) {
                                            for (const parcelVertex of parcelCoords) {
                                                if (pointInPolygon(parcelVertex, featureCoords)) {
                                                    isOverlapping = true;
                                                    break;
                                                }
                                            }
                                            if (isOverlapping) break;
                                            for (const featureVertex of featureCoords) {
                                                if (pointInPolygon(featureVertex, parcelCoords)) {
                                                    isOverlapping = true;
                                                    break;
                                                }
                                            }
                                            if (isOverlapping) break;
                                        }
                                    }
                                }
                            }
                            if (isOverlapping) {
                                results.overlap[category].push({
                                    name: item.name,
                                    file: item.file,
                                    region: region
                                });
                                console.log(`✅ ${region}/${category} - ${item.name}: 포함됨`);
                            }
                        }
                        
                        if (['경관거점', '2040조망점'].includes(category)) {
                            for (const feature of geojson.features) {
                                if (feature.geometry.type === 'Point') {
                                    const [pLng, pLat] = feature.geometry.coordinates;
                                    const distance = getDistance(lat, lng, pLat, pLng);
                                    if (distance <= radius) {
                                        let actualName = item.name;
                                        if (feature.properties) {
                                            if (category === '2040조망점' && feature.properties['명칭']) { actualName = feature.properties['명칭']; }
                                            else if (category === '경관거점' && feature.properties['거점명']) { actualName = feature.properties['거점명']; }
                                            else if (feature.properties.name || feature.properties.NAME) { actualName = feature.properties.name || feature.properties.NAME; }
                                        }
                                        results.nearby[category].push({
                                            name: item.name, actualName: actualName, distance: distance.toFixed(2),
                                            properties: feature.properties, coordinates: [pLat, pLng], region: region
                                        });
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.log(`⚠️ ${region}/${category}/${item.file} 분석 중 오류:`, error.message);
                    }
                }
            }
        }

        console.log('✅ 분석 완료');
        res.json({ success: true, data: results });
    } catch (error) {
        console.error('분석 오류:', error);
        res.status(500).json({ error: '분석 실패', details: error.message });
    }
});

// =================================================================
// [수정] VWorld Address Search API (HTTPS 및 Domain 파라미터 적용)
// =================================================================
app.post('/api/search/address', async (req, res) => {
    try {
        const { keyword } = req.body;
        if (!keyword) {
            return res.json({ success: false, error: '검색어가 없습니다.' });
        }
        console.log(`\n🔍 VWorld 주소 검색 시작: ${keyword}`);

        // --- Step 1: VWorld 'GetAddress' API (HTTPS) ---
        // [수정] http -> https
        const addressUrl = 'https://api.vworld.kr/req/address';
        const addressParams = {
            service: 'address', request: 'GetAddress', version: '2.0',
            query: keyword, type: 'PARCEL', size: 1, output: 'json',
            key: VWORLD_API_KEY
        };

        const addressResponse = await axios.get(addressUrl, { params: addressParams, timeout: 5000 });

        if (addressResponse.data.response.status !== 'OK' || addressResponse.data.response.result.items.length === 0) {
            console.warn('⚠️ VWorld 주소 검색 실패. Kakao로 Fallback합니다.');
            return res.json({ success: false, error: 'VWorld에서 주소를 찾을 수 없습니다.' });
        }

        const firstResult = addressResponse.data.response.result.items[0];
        const pnu = firstResult.structure.pnu;
        const foundAddress = firstResult.address.parcel;
        const lat = parseFloat(firstResult.point.y);
        const lng = parseFloat(firstResult.point.x);
        if (!pnu) console.warn('⚠️ VWorld 주소에서 PNU를 찾지 못했습니다. (좌표만 사용)');
        console.log(`✅ VWorld 주소 검색 성공: ${foundAddress} (PNU: ${pnu || '없음'})`);

        // --- Step 2: Use PNU to get precise parcel boundary from WFS (HTTPS + Domain) ---
        let foundGeometry = null;
        if (pnu) {
            try {
                // [수정] http -> https
                const wfsUrl = 'https://api.vworld.kr/req/wfs';
                const wfsParams = {
                    service: 'wfs', version: '2.0.0', request: 'GetFeature',
                    typename: 'lp_pa_cbnd', cql_filter: `pnu='${pnu}'`,
                    srsname: 'EPSG:4326', output: 'application/json', key: VWORLD_API_KEY, 
                    // [수정] Vercel 환경 변수에서 도메인 읽어오기
                    domain: VWORLD_DOMAIN
                };
                
                const wfsResponse = await axios.get(wfsUrl, { params: wfsParams, timeout: 10000 });
                if (wfsResponse.data && wfsResponse.data.features && wfsResponse.data.features.length > 0) {
                    foundGeometry = wfsResponse.data.features[0].geometry;
                    console.log('✅ WFS (PNU) 필지 경계 조회 성공');
                } else {
                    console.warn('⚠️ WFS (PNU) 조회 실패. BBOX + bubun 레이어로 재시도합니다.');
                }
            } catch (wfsPnuError) {
                console.warn(`❌ WFS (PNU) 오류: ${wfsPnuError.message}. BBOX + bubun 레이어로 재시도합니다.`);
            }
        }

        // --- Step 3: [MODIFIED FALLBACK] (HTTPS + Domain) ---
        if (!foundGeometry) {
            console.log('ℹ️ (주소검색 BBOX Fallback) BBOX + bubun 레이어로 재시도합니다.');
            const bboxSize = 0.005; 
            const bbox = `${lng - bboxSize},${lat - bboxSize},${lng + bboxSize},${lat + bboxSize}`;
            
            // [수정] http -> https
            const wfsUrl_fallback = 'https://api.vworld.kr/req/wfs';
            const params_fallback = {
                service: 'wfs', version: '2.0.0', request: 'GetFeature',
                typename: 'lp_pa_cbnd_bubun', bbox: bbox, 
                srsname: 'EPSG:4326', output: 'application/json', key: VWORLD_API_KEY, 
                // [수정] Vercel 환경 변수에서 도메인 읽어오기
                domain: VWORLD_DOMAIN
            };

            try {
                const response_fallback = await axios.get(wfsUrl_fallback, { params: params_fallback, timeout: 10000 });
                if (response_fallback.data && response_fallback.data.features && response_fallback.data.features.length > 0) {
                    let containingFeature = null;
                    const searchPoint = [lng, lat]; 
                    for (const feature of response_fallback.data.features) {
                        if (containingFeature) break; 
                        if (!feature.geometry || !feature.geometry.coordinates) continue;
                        let featurePolygons = [];
                        if (feature.geometry.type === 'Polygon') featurePolygons.push(feature.geometry.coordinates[0]);
                        else if (feature.geometry.type === 'MultiPolygon') feature.geometry.coordinates.forEach(poly => featurePolygons.push(poly[0]));
                        for (const coords of featurePolygons) {
                            if (Array.isArray(coords) && coords.length > 0 && pointInPolygon(searchPoint, coords)) {
                                containingFeature = feature;
                                break; 
                            }
                        }
                    }
                    if (containingFeature) {
                        foundGeometry = containingFeature.geometry;
                        console.log('✅ (주소검색 BBOX Fallback) WFS (BBOX Fallback) 조회 성공 (Point in Polygon)');
                    } else {
                        console.warn('⚠️ (주소검색 BBOX Fallback) BBOX 내에서 좌표를 포함하는 필지를 찾지 못했습니다.');
                    }
                } else {
                     console.warn('⚠️ (주소검색 BBOX Fallback) BBOX + bubun 레이어 조회 결과가 없습니다.');
                }
            } catch (bboxError) {
                 console.error('❌ (주소검색 BBOX Fallback) WFS (BBOX) 오류:', bboxError.message);
            }
        }
        
        // --- Step 4: Return final result ---
        res.json({
            success: true, lat: lat, lng: lng,
            address: foundAddress,
            geometry: foundGeometry // Found by PNU or BBOX, or null if both failed
        });

    } catch (error) {
        console.error('❌ VWorld 주소 검색 API 오류:', error.message);
        res.json({ success: false, error: 'VWorld API 호출 실패', details: error.message });
    }
});


// =================================================================
// [수정] Parcel API (/api/parcel) (HTTPS 및 Domain 파라미터 적용)
// =================================================================
app.get('/api/parcel', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: '좌표가 필요합니다.' });

        console.log(`\n🔍 Kakao Fallback 필지 조회 시작: ${lat}, ${lng}`);
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        // --- Step 1: VWorld 'Coord2Address' API (HTTPS) ---
        let pnu = null;
        try {
            // [수정] http -> https
            const addressUrl = 'https://api.vworld.kr/req/address';
            const addressParams = {
                service: 'address', request: 'GetAddress', version: '2.0',
                coords: `${longitude},${latitude}`, type: 'PARCEL', output: 'json',
                key: VWORLD_API_KEY
            };
            
            const addressResponse = await axios.get(addressUrl, { params: addressParams, timeout: 5000 });
            if (addressResponse.data.response.status === 'OK' && addressResponse.data.response.result.length > 0) {
                pnu = addressResponse.data.response.result[0].structure.pnu;
                console.log(`✅ (Fallback) PNU 코드 조회 성공: ${pnu}`);
            } else {
                console.warn('⚠️ (Fallback) VWorld Coord2Address API에서 PNU 코드를 찾지 못했습니다.');
            }
        } catch (addrError) {
            console.error('❌ (Fallback) VWorld Coord2Address API 오류:', addrError.message);
        }

        // --- Step 2: WFS cql_filter (HTTPS + Domain) ---
        if (pnu) {
            try {
                // [수정] http -> https
                const wfsUrl = 'https://api.vworld.kr/req/wfs';
                const wfsParams = {
                    service: 'wfs', version: '2.0.0', request: 'GetFeature',
                    typename: 'lp_pa_cbnd', cql_filter: `pnu='${pnu}'`, 
                    srsname: 'EPSG:4326', output: 'application/json', key: VWORLD_API_KEY, 
                    // [수정] Vercel 환경 변수에서 도메인 읽어오기
                    domain: VWORLD_DOMAIN
                };

                const response = await axios.get(wfsUrl, { params: wfsParams, timeout: 10000 });
                if (response.data && response.data.features && response.data.features.length > 0) {
                    console.log('✅ (Fallback) WFS (PNU) 조회 성공');
                    res.json({ success: true, geometry: response.data.features[0].geometry, properties: response.data.features[0].properties });
                    return; 
                } else {
                     console.warn('⚠️ (Fallback) WFS (PNU) 조회 실패. BBOX로 재시도합니다.');
                }
            } catch (wfsPnuError) {
                console.warn(`❌ (Fallback) WFS (PNU) 오류: ${wfsPnuError.message}. BBOX로 재시도합니다.`);
            }
        }

        // --- Step 3: [MODIFIED FALLBACK] (HTTPS + Domain) ---
        console.log('ℹ️ (Fallback) PNU 조회 실패. BBOX + bubun 레이어로 재시도합니다.');
        const bboxSize = 0.005; 
        const bbox = `${longitude - bboxSize},${latitude - bboxSize},${longitude + bboxSize},${latitude + bboxSize}`;
        
        // [수정] http -> https
        const wfsUrl_fallback = 'https://api.vworld.kr/req/wfs';
        const params_fallback = {
            service: 'wfs', version: '2.0.0', request: 'GetFeature',
            typename: 'lp_pa_cbnd_bubun', bbox: bbox, 
            srsname: 'EPSG:4326', output: 'application/json', key: VWORLD_API_KEY, 
            // [수정] Vercel 환경 변수에서 도메인 읽어오기
            domain: VWORLD_DOMAIN
        };

        const response = await axios.get(wfsUrl_fallback, { params: params_fallback, timeout: 10000 });
        if (response.data && response.data.features && response.data.features.length > 0) {
            let containingFeature = null;
            const searchPoint = [longitude, latitude]; 
            for (const feature of response.data.features) {
                if (containingFeature) break; 
                if (!feature.geometry || !feature.geometry.coordinates) continue;
                let featurePolygons = [];
                if (feature.geometry.type === 'Polygon') featurePolygons.push(feature.geometry.coordinates[0]);
                else if (feature.geometry.type === 'MultiPolygon') feature.geometry.coordinates.forEach(poly => featurePolygons.push(poly[0]));
                for (const coords of featurePolygons) {
                    if (Array.isArray(coords) && coords.length > 0 && pointInPolygon(searchPoint, coords)) {
                        containingFeature = feature;
                        break; 
                    }
                }
            }
            if (containingFeature) {
                console.log('✅ (Fallback) WFS (BBOX Fallback) 조회 성공 (Point in Polygon)');
                res.json({ success: true, geometry: containingFeature.geometry, properties: containingFeature.properties });
            } else {
                console.warn('⚠️ (Fallback) BBOX 내에서 좌표를 포함하는 필지를 찾지 못했습니다.');
                res.json({ success: false, message: 'BBOX 내에서 좌표를 포함하는 필지를 찾을 수 없습니다.' });
            }
        } else {
            console.warn('⚠️ (Fallback) BBOX + bubun 레이어 조회 결과가 없습니다.');
            res.json({ success: false, message: '해당 위치에 필지 데이터가 없습니다.' });
        }
    } catch (error) {
        console.error('필지 조회 오류:', error.message);
        res.status(500).json({ error: 'VWorld API 호출 실패', details: error.message });
    }
});


// =================================================================
// [Original Feature] Chat Helper Functions & APIs
// (수정 없음)
// =================================================================

function buildSystemPrompt(analysisContext, lawDataJson, isFollowUp = false) {
    const { overlap, nearby, address, region } = analysisContext;
    let planName = "광주광역시 2040 도시경관계획";
    let regionOrdinance = "광주광역시 경관조례";
    if (region === '전라남도') {
        planName = "전라남도 경관계획";
        regionOrdinance = "전라남도 경관조례";
    } else if (region === '전라북도') {
        planName = "전라북도 경관계획";
        regionOrdinance = "전라북도 경관조례";
    } else if (region !== '광주광역시') {
        throw new Error(`AI 분석 미지원 지역: ${region || '없음'}`);
    }
    const simpleOverlap = {};
    if (overlap) {
        for (const [key, value] of Object.entries(overlap)) {
            const regionValues = value.filter(v => v.region === region);
            if (regionValues.length > 0) simpleOverlap[key] = regionValues.map(v => v.name).join(', ');
        }
    }
    const simpleNearby = {};
    if (nearby) {
        for (const [key, value] of Object.entries(nearby)) {
            const regionValues = value.filter(v => v.region === region);
            if (regionValues.length > 0) simpleNearby[key] = regionValues.sort((a, b) => a.distance - b.distance).map(v => `${v.actualName} (${v.distance}km)`);
        }
    }
    let prompt = `당신은 "${planName}" 및 관련 경관법규(경관법, 시행령, ${regionOrdinance})를 완벽하게 숙지하고 있는 전문 AI 경관 검토관입니다.

다음은 **반드시 준수해야 할 경관심의 판단 기준(law.json)**입니다. 이 내용을 최우선으로 적용해야 합니다.
---
[경관심의 판단 기준 (law.json)]
${JSON.stringify(lawDataJson, null, 2)}
---

다음 대상지에 대한 경관 분석 데이터를 기반으로 사용자와 대화하고 있습니다.

▪ 대상지: ${address} (지역: ${region})

▪ 경관 분석 데이터 (시스템)
- 겹치는 경관구역 (면): ${JSON.stringify(simpleOverlap, null, 2) || 'N/A'}
- 반경 내 경관요소 (점): ${JSON.stringify(simpleNearby, null, 2) || 'N/A'}
`;
    if (!isFollowUp) {
        prompt += `
위에서 제공된 **[경관심의 판단 기준 (law.json)]**의 내용을 "종합적으로 직접 참조하여" 다음 두 섹션으로 나누어 상세한 검토 의견을 작성해주세요.
(사용자가 입력할 '사업 개요'를 기다리고 있습니다.)
---

### 1. 법규 검토 및 심의 대상 여부

1.  **관련 법규:** ...
2.  **심의/검토 대상 여부 (매우 중요):**
    * ...

---

### 2. ${planName} 상세 지침

... (기존 analyze_chat 프롬프트의 나머지 지침) ...
* **경관구조 (${simpleOverlap['경관구조'] || 'N/A'}):** ...
* **중점경관관리구역 (${simpleOverlap['중점경관관리구역'] || 'N/A'}):** ...
* **경관지구 (${simpleOverlap['경관지구'] || 'N/A'}):** ...
* **경관거점 (인근 ${simpleNearby['경관거점'] ? simpleNearby['경관거점'].length : 0}개소):** ...
* **2040조망점 (인근 ${simpleNearby['2040조망점'] ? simpleNearby['2040조망점'].length : 0}개소):** ...
`;
    } 
    else {
        prompt += `
---
이 컨텍스트를 바탕으로 사용자의 질문에 답변하세요.
`;
    }
    return prompt;
}

app.post('/api/gemini/analyze_chat', async (req, res) => {
    try {
        const { overlap, nearby, address, region, lat, lng, projectInfoText } = req.body;
        if (!projectInfoText) return res.json({ success: false, error: '사업 개요 텍스트가 없습니다.', response: '사업 개요(예: "건축물, 20층")를 입력해야 검토를 시작할 수 있습니다.' });
        if (!lawData) {
            await loadLawData(); 
            if (!lawData) return res.json({ success: false, error: '법규 데이터(law.json)가 로드되지 않았습니다.', response: '서버 오류: 법규 데이터를 로드하지 못했습니다. 관리자에게 문의하세요.' });
        }
        console.log(`\n🤖 AI 초기 검토 시작 (채팅 기반): ${address}`);
        const analysisContext = { overlap, nearby, address, region, lat, lng };
        let systemPrompt;
        try {
            systemPrompt = buildSystemPrompt(analysisContext, lawData, false);
        } catch (error) {
            return res.json({ success: false, error: error.message, response: `AI 분석은 현재 광주광역시, 전라남도, 전라북도 지역만 지원합니다. (감지된 지역: ${region || '없음'})`});
        }
        const fullPrompt = `${systemPrompt}

▪ 사업 개요 (사용자 입력)
- 사업 개요 (사용자 입력): ${projectInfoText}
`;
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
            { contents: [{ parts: [{ text: fullPrompt }] }] },
            { headers: { 'Content-Type': 'application/json' } }
        );
        const analysis = response.data.candidates[0].content.parts[0].text;
        res.json({ success: true, response: analysis });
    } catch (error) {
        console.error('Gemini 초기 검토 API 오류:', error.response ? error.response.data : error.message);
        res.json({ success: false, error: 'AI 분석 실패', response: 'AI 분석 중 오류가 발생했습니다. 입력한 사업 개요와 상세결과를 바탕으로 관할 지자체에 경관심의 대상 여부를 문의하시기 바랍니다.' });
    }
});

app.post('/api/gemini/chat', async (req, res) => {
    try {
        const { history, analysisContext } = req.body;
        if (!history || history.length === 0) return res.status(400).json({ success: false, error: '대화 내역이 없습니다.' });
        if (!analysisContext || !analysisContext.address) return res.status(400).json({ success: false, error: '분석 컨텍스트가 없습니다.' });
        if (!lawData) {
             await loadLawData(); 
            if (!lawData) return res.status(400).json({ success: false, error: '법규 데이터(law.json)가 로드되지 않았습니다.' });
        }
        console.log(`\n💬 AI 채팅 API 호출 (대화 턴: ${history.length})`);
        const systemPrompt = buildSystemPrompt(analysisContext, lawData, true);
        const contents = [
            { role: 'user', parts: [{ text: systemPrompt }] },
            { role: 'model', parts: [{ text: '네, 대상지 컨텍스트를 확인했습니다. 대화를 계속하세요.' }] },
            ...history 
        ];
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
            { contents: contents },
            { headers: { 'Content-Type': 'application/json' } }
        );
        const aiResponse = response.data.candidates[0].content.parts[0].text;
        res.json({ success: true, response: aiResponse });
    } catch (error) {
        console.error('Gemini 채팅 API 오류:', error.response ? error.response.data : error.message);
        res.json({ success: false, error: 'AI 채팅 응답 실패', response: '죄송합니다. AI 응답 생성 중 오류가 발생했습니다.'});
    }
});

// === [수정] 서버 시작 시 모든 데이터 로드 ===
// Vercel이 서버를 실행할 수 있도록 app을 export합니다.
// 로컬 테스트 및 Vercel 초기 실행을 위해 데이터 로드 함수를 호출합니다.
async function initializeApp() {
    await loadLawData();
    await loadAllGeojsonFiles();
    console.log('\n========================================');
    console.log(`✅ 경관검토 시스템 초기화 완료`);
    console.log(`🤖 Gemini API: ${GEMINI_API_KEY ? '연결됨' : '미설정'}`);
    console.log(`🌐 VWorld Domain: ${VWORLD_DOMAIN || '미설정'}`);
    console.log('========================================\n');
}

initializeApp(); // 서버 시작 시 데이터 로드 실행
module.exports = app;
