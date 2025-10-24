// server.js (수정본)
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// === CORS 추가 ===
app.use(cors());

// 정적 파일 제공
app.use(express.static('public'));
app.use(express.json());

require('dotenv').config();

const VWORLD_API_KEY = process.env.VWORLD_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEOJSON_DIR = path.join(process.cwd(), 'geojson');
let lawData = null;

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

// ------------------ 유틸 (좌표 정규화, pointInPolygon 개선) ------------------

// 좌표 쌍의 순서를 검사하고 [lng, lat] 순으로 보정합니다.
// heuristic: 좌표 [a,b] 에서 |a|<=90 && |b|<=180 이면 (a가 latitude 범위) -> 아마 [lat,lng] 이므로 flip 필요
function normalizeCoordinatePair(pair) {
    if (!Array.isArray(pair) || pair.length < 2) return pair;
    const a = Number(pair[0]), b = Number(pair[1]);
    if (!isFinite(a) || !isFinite(b)) return pair;
    // latitude 범위는 보통 -90..90, longitude -180..180
    const aIsLat = Math.abs(a) <= 90 && Math.abs(b) <= 180;
    const aIsLng = Math.abs(a) <= 180 && Math.abs(b) <= 90;
    // 둘 다 true일 수 있지만 우선순위: aIsLat && !aIsLng => flip
    if (aIsLat && !aIsLng) {
        // 현재 pair는 [lat, lng]처럼 보이므로 flip -> [lng, lat]
        return [b, a];
    }
    // 그 외엔 그대로 [lng,lat]로 가정
    return [a, b];
}

// 다차원 배열(Polygon, MultiPolygon 등)에 재귀적으로 적용
function normalizeCoordinatesRecursive(coords) {
    if (!Array.isArray(coords)) return coords;
    if (coords.length === 0) return coords;
    // 마지막 레벨(좌표 쌍)을 감지
    if (typeof coords[0] === 'number') {
        return normalizeCoordinatePair(coords);
    }
    return coords.map(normalizeCoordinatesRecursive);
}

// 개선된 point-in-polygon (ray-casting), point: [lng,lat], polygon: array of [lng,lat]
function pointInPolygon(point, polygon) {
    const [x, y] = point;
    if (!isFinite(x) || !isFinite(y)) return false;
    if (!Array.isArray(polygon) || polygon.length === 0) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = Number(polygon[i][0]), yi = Number(polygon[i][1]);
        const xj = Number(polygon[j][0]), yj = Number(polygon[j][1]);
        if (![xi, yi, xj, yj].every(isFinite)) continue;
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// ------------------ API: GeoJSON 목록 / 로드 ------------------

app.get('/api/geojson/list', async (req, res) => {
    try {
        const result = {};
        const regions = (await fs.readdir(GEOJSON_DIR, { withFileTypes: true }))
            .filter(dir => dir.isDirectory())
            .map(dir => dir.name);

        for (const region of regions) {
            result[region] = {};
            const regionPath = path.join(GEOJSON_DIR, region);
            try {
                const categories = (await fs.readdir(regionPath, { withFileTypes: true }))
                    .filter(dir => dir.isDirectory())
                    .map(dir => dir.name);
                
                for (const category of categories) {
                    result[region][category] = [];
                    const categoryPath = path.join(regionPath, category);
                    try {
                        const files = (await fs.readdir(categoryPath))
                            .filter(f => f.endsWith('.geojson') || f.endsWith('.json'));
                        
                        for (const file of files) {
                            const name = file.replace(/\.(geojson|json)$/, '');
                            result[region][category].push({
                                name: name,
                                file: file,
                                exists: true
                            });
                        }
                    } catch (err) {
                        console.warn(`⚠️ ${categoryPath} 읽기 실패:`, err.message);
                    }
                }
            } catch (err) {
                console.warn(`⚠️ ${regionPath} 읽기 실패:`, err.message);
            }
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('GeoJSON 목록 조회 오류:', error);
        res.status(500).json({ error: '파일 목록 조회 실패', details: error.message });
    }
});

app.get('/api/geojson/load', async (req, res) => {
    try {
        const { region, category, file } = req.query;
        if (!region || !category || !file) {
            return res.status(400).json({ success: false, error: '지역, 카테고리 또는 파일 이름이 없습니다.' });
        }
        const filePath = path.join(GEOJSON_DIR, region, category, file);
        const data = await fs.readFile(filePath, 'utf8');
        const geojson = JSON.parse(data);
        // Return as-is but ensure features array present
        res.json({ success: true, data: geojson });
    } catch (error) {
        console.error('❌ GeoJSON 로드 오류:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// ------------------ API: 주소 검색 (/api/search/address) ------------------

app.post('/api/search/address', async (req, res) => {
    try {
        const { keyword } = req.body;
        if (!keyword) return res.json({ success: false, error: '검색어가 없습니다.' });

        // Step 1: VWorld 주소 검색
        const addressUrl = 'https://api.vworld.kr/req/address';
        const addressParams = {
            service: 'address',
            request: 'GetAddress',
            version: '2.0',
            query: keyword,
            type: 'PARCEL',
            size: 1,
            output: 'json',
            key: VWORLD_API_KEY
        };

        const addressResponse = await axios.get(addressUrl, { params: addressParams, timeout: 5000 });

        if (!addressResponse.data || addressResponse.data.response.status !== 'OK' ||
            !addressResponse.data.response.result.items || addressResponse.data.response.result.items.length === 0) {
            return res.json({ success: false, error: 'VWorld에서 주소를 찾을 수 없습니다.' });
        }

        const firstResult = addressResponse.data.response.result.items[0];
        const pnu = firstResult.structure ? firstResult.structure.pnu : null;
        const foundAddress = firstResult.address ? firstResult.address.parcel : (firstResult.address ? firstResult.address.road : '알수없음');
        const lat = parseFloat(firstResult.point.y);
        const lng = parseFloat(firstResult.point.x);

        let foundGeometry = null;

        if (pnu) {
            try {
                const wfsUrl = 'https://api.vworld.kr/req/wfs';
                const wfsParams = {
                    service: 'wfs', version: '2.0.0', request: 'GetFeature',
                    typename: 'lp_pa_cbnd',
                    cql_filter: `pnu='${pnu}'`,
                    srsname: 'EPSG:4326',
                    output: 'application/json', key: VWORLD_API_KEY
                };
                const wfsResponse = await axios.get(wfsUrl, { params: wfsParams, timeout: 10000 });
                if (wfsResponse.data && wfsResponse.data.features && wfsResponse.data.features.length > 0) {
                    foundGeometry = wfsResponse.data.features[0].geometry;
                }
            } catch (err) {
                console.warn('WFS (PNU) 오류:', err.message);
            }
        }

        // Fallback: BBOX + bubun (찾는 지번의 폴리곤을 BBOX에서 point-in-polygon 으로 찾음)
        if (!foundGeometry) {
            const bboxSize = 0.005;
            const bbox = `${lng - bboxSize},${lat - bboxSize},${lng + bboxSize},${lat + bboxSize}`;
            const wfsUrl_fallback = 'https://api.vworld.kr/req/wfs';
            const params_fallback = {
                service: 'wfs', version: '2.0.0', request: 'GetFeature',
                typename: 'lp_pa_cbnd_bubun',
                bbox: bbox, srsname: 'EPSG:4326',
                output: 'application/json', key: VWORLD_API_KEY
            };
            try {
                const resp = await axios.get(wfsUrl_fallback, { params: params_fallback, timeout: 10000 });
                if (resp.data && resp.data.features && resp.data.features.length > 0) {
                    const searchPoint = [lng, lat];
                    let containingFeature = null;
                    for (const feature of resp.data.features) {
                        if (!feature.geometry || !feature.geometry.coordinates) continue;
                        let featurePolygons = [];
                        if (feature.geometry.type === 'Polygon') {
                            featurePolygons.push(feature.geometry.coordinates[0]);
                        } else if (feature.geometry.type === 'MultiPolygon') {
                            feature.geometry.coordinates.forEach(poly => featurePolygons.push(poly[0]));
                        }
                        for (const coords of featurePolygons) {
                            // coords = array of [lng,lat] or maybe [lat,lng] -> normalize first element to be safe
                            const normalizedRing = coords.map(c => normalizeCoordinatePair(c));
                            if (pointInPolygon(searchPoint, normalizedRing)) {
                                containingFeature = feature;
                                break;
                            }
                        }
                        if (containingFeature) break;
                    }
                    if (containingFeature) {
                        foundGeometry = containingFeature.geometry;
                    }
                }
            } catch (err) {
                console.warn('WFS (BBOX) 오류:', err.message);
            }
        }

        // 반환 시 항상 GeoJSON FeatureCollection 형태로 보냄 -> 클라이언트에서 바로 L.geoJSON(...) 등으로 그림
        const drawGeometry = foundGeometry ? {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: { source: 'parcel_search' },
                geometry: foundGeometry
            }]
        } : null;

        res.json({
            success: true,
            lat,
            lng,
            address: foundAddress,
            geometry: foundGeometry,
            drawGeometry // 표준화된 그리기용 GeoJSON
        });

    } catch (error) {
        console.error('❌ VWorld 주소 검색 API 오류:', error.message);
        res.json({ success: false, error: 'VWorld API 호출 실패', details: error.message });
    }
});

// ------------------ API: parcel (좌표 -> 필지) ------------------

app.get('/api/parcel', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: '좌표가 필요합니다.' });

        const latitude = parseFloat(lat);
        const longitude = parseFloat(lng);

        // VWorld coord->address 로 PNU 가져오기 시도
        let pnu = null;
        try {
            const addressUrl = 'https://api.vworld.kr/req/address';
            const addressParams = {
                service: 'address',
                request: 'GetAddress',
                version: '2.0',
                coords: `${longitude},${latitude}`,
                type: 'PARCEL',
                output: 'json',
                key: VWORLD_API_KEY
            };
            const addrResp = await axios.get(addressUrl, { params: addressParams, timeout: 5000 });
            if (addrResp.data && addrResp.data.response && addrResp.data.response.status === 'OK'
                && addrResp.data.response.result && addrResp.data.response.result.length > 0) {
                pnu = addrResp.data.response.result[0].structure ? addrResp.data.response.result[0].structure.pnu : null;
            }
        } catch (err) {
            console.warn('Coord->Address 오류:', err.message);
        }

        if (pnu) {
            try {
                const wfsUrl = 'https://api.vworld.kr/req/wfs';
                const wfsParams = {
                    service: 'wfs', version: '2.0.0', request: 'GetFeature',
                    typename: 'lp_pa_cbnd',
                    cql_filter: `pnu='${pnu}'`,
                    srsname: 'EPSG:4326',
                    output: 'application/json', key: VWORLD_API_KEY
                };
                const resp = await axios.get(wfsUrl, { params: wfsParams, timeout: 10000 });
                if (resp.data && resp.data.features && resp.data.features.length > 0) {
                    const feature = resp.data.features[0];
                    const drawGeometry = {
                        type: 'FeatureCollection',
                        features: [{
                            type: 'Feature',
                            properties: feature.properties || {},
                            geometry: feature.geometry
                        }]
                    };
                    return res.json({ success: true, geometry: feature.geometry, properties: feature.properties, drawGeometry });
                }
            } catch (err) {
                console.warn('WFS (PNU) 오류:', err.message);
            }
        }

        // Fallback BBOX search
        const bboxSize = 0.005;
        const bbox = `${longitude - bboxSize},${latitude - bboxSize},${longitude + bboxSize},${latitude + bboxSize}`;
        const wfsUrl_fallback = 'https://api.vworld.kr/req/wfs';
        const params_fallback = {
            service: 'wfs', version: '2.0.0', request: 'GetFeature',
            typename: 'lp_pa_cbnd_bubun',
            bbox: bbox, srsname: 'EPSG:4326',
            output: 'application/json', key: VWORLD_API_KEY
        };

        const response = await axios.get(wfsUrl_fallback, { params: params_fallback, timeout: 10000 });

        if (response.data && response.data.features && response.data.features.length > 0) {
            let containingFeature = null;
            const searchPoint = [longitude, latitude];
            for (const feature of response.data.features) {
                if (!feature.geometry || !feature.geometry.coordinates) continue;
                let featurePolygons = [];
                if (feature.geometry.type === 'Polygon') {
                    featurePolygons.push(feature.geometry.coordinates[0]);
                } else if (feature.geometry.type === 'MultiPolygon') {
                    feature.geometry.coordinates.forEach(poly => featurePolygons.push(poly[0]));
                }
                for (const coords of featurePolygons) {
                    const normalizedRing = coords.map(c => normalizeCoordinatePair(c));
                    if (pointInPolygon(searchPoint, normalizedRing)) {
                        containingFeature = feature;
                        break;
                    }
                }
                if (containingFeature) break;
            }
            if (containingFeature) {
                const drawGeometry = {
                    type: 'FeatureCollection',
                    features: [{
                        type: 'Feature',
                        properties: containingFeature.properties || {},
                        geometry: containingFeature.geometry
                    }]
                };
                return res.json({ success: true, geometry: containingFeature.geometry, properties: containingFeature.properties, drawGeometry });
            } else {
                return res.json({ success: false, message: 'BBOX 내에서 좌표를 포함하는 필지를 찾을 수 없습니다.' });
            }
        } else {
            return res.json({ success: false, message: '해당 위치에 필지 데이터가 없습니다.' });
        }
    } catch (error) {
        console.error('필지 조회 오류:', error.message);
        res.status(500).json({ error: 'VWorld API 호출 실패', details: error.message });
    }
});

// ------------------ API: 분석 (/api/analyze) ------------------

app.post('/api/analyze', async (req, res) => {
    try {
        const { lat, lng, layers, radius = 3.0, parcelGeometry } = req.body;
        const results = { overlap: {}, nearby: {} };
        const point = [Number(lng), Number(lat)];

        // parcelGeometry가 들어오면 좌표 정규화(ensure [lng,lat])
        let parcelPolygons = [];
        if (parcelGeometry) {
            const geom = JSON.parse(JSON.stringify(parcelGeometry)); // 복사
            // normalize coordinates recursively
            if (geom.type === 'Polygon') {
                const normalized = geom.coordinates[0].map(c => normalizeCoordinatePair(c));
                parcelPolygons.push(normalized);
            } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach(poly => {
                    const normalized = poly[0].map(c => normalizeCoordinatePair(c));
                    parcelPolygons.push(normalized);
                });
            } else if (geom.type === 'FeatureCollection' || geom.type === 'Feature') {
                const features = geom.type === 'Feature' ? [geom] : geom.features;
                for (const f of features) {
                    if (!f.geometry) continue;
                    if (f.geometry.type === 'Polygon') {
                        parcelPolygons.push(f.geometry.coordinates[0].map(c => normalizeCoordinatePair(c)));
                    } else if (f.geometry.type === 'MultiPolygon') {
                        f.geometry.coordinates.forEach(poly => parcelPolygons.push(poly[0].map(c => normalizeCoordinatePair(c))));
                    }
                }
            }
        }

        // layers 순회
        for (const [region, categories] of Object.entries(layers || {})) {
            for (const [category, items] of Object.entries(categories || {})) {
                if (!items || items.length === 0) continue;
                if (!results.overlap[category]) results.overlap[category] = [];
                if (!results.nearby[category]) results.nearby[category] = [];

                for (const item of items) {
                    try {
                        const filePath = path.join(GEOJSON_DIR, region, category, item.file);
                        const data = await fs.readFile(filePath, 'utf8');
                        const geojson = JSON.parse(data);

                        let isOverlapping = false;

                        if (['경관구조', '중점경관관리구역', '경관지구'].includes(category)) {
                            for (const feature of geojson.features) {
                                if (isOverlapping) break;
                                const geom = feature.geometry;
                                let featurePolygons = [];
                                if (!geom) continue;
                                if (geom.type === 'Polygon') featurePolygons.push(geom.coordinates[0]);
                                else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(polyCoords => featurePolygons.push(polyCoords[0]));

                                for (const featureCoords of featurePolygons) {
                                    // normalize feature coords to [lng,lat]
                                    const normalizedFeature = featureCoords.map(c => normalizeCoordinatePair(c));

                                    // 대상지 점 포함 여부 검사
                                    if (pointInPolygon(point, normalizedFeature)) {
                                        isOverlapping = true;
                                        break;
                                    }

                                    // 필지(입력된 parcel)와 겹치는지 검사 (정점들 상호 포함 검사)
                                    if (parcelPolygons.length > 0) {
                                        for (const parcelCoords of parcelPolygons) {
                                            // parcelCoords and normalizedFeature are both arrays of [lng,lat]
                                            // 1) parcel vertex가 feature 내부에 있는지
                                            for (const parcelVertex of parcelCoords) {
                                                if (pointInPolygon(parcelVertex, normalizedFeature)) {
                                                    isOverlapping = true;
                                                    break;
                                                }
                                            }
                                            if (isOverlapping) break;
                                            // 2) feature vertex가 parcel 내부에 있는지
                                            for (const featureVertex of normalizedFeature) {
                                                if (pointInPolygon(featureVertex, parcelCoords)) {
                                                    isOverlapping = true;
                                                    break;
                                                }
                                            }
                                            if (isOverlapping) break;
                                        }
                                    }
                                    if (isOverlapping) break;
                                }
                                if (isOverlapping) break;
                            }
                            if (isOverlapping) {
                                results.overlap[category].push({ name: item.name, file: item.file, region: region });
                            }
                        }

                        if (['경관거점', '2040조망점'].includes(category)) {
                            for (const feature of geojson.features) {
                                if (feature.geometry && feature.geometry.type === 'Point') {
                                    const [pLng, pLat] = feature.geometry.coordinates;
                                    const distance = getDistance(lat, lng, pLat, pLng);
                                    if (distance <= radius) {
                                        let actualName = item.name;
                                        if (feature.properties) {
                                            if (category === '2040조망점' && feature.properties['명칭']) actualName = feature.properties['명칭'];
                                            else if (category === '경관거점' && feature.properties['거점명']) actualName = feature.properties['거점명'];
                                            else if (feature.properties.name || feature.properties.NAME) actualName = feature.properties.name || feature.properties.NAME;
                                        }
                                        results.nearby[category].push({
                                            name: item.name,
                                            actualName,
                                            distance: distance.toFixed(2),
                                            properties: feature.properties,
                                            coordinates: [pLat, pLng],
                                            region
                                        });
                                    }
                                }
                            }
                        }

                    } catch (error) {
                        console.warn(`⚠️ ${region}/${category}/${item.file} 로드 실패:`, error.message);
                    }
                }
            }
        }

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('분석 오류:', error);
        res.status(500).json({ error: '분석 실패', details: error.message });
    }
});

// ------------------ AI 관련 API는 기존 방식 유지 ------------------
// (buildSystemPrompt, gemini APIs 등은 기존 코드와 동일하므로 생략하지 않고 그대로 유지한다.)
// ... (기존 buildSystemPrompt, /api/gemini/* 코드) ...

// 마지막: law.json 로드, app export (Vercel용)
loadLawData();
module.exports = app;
