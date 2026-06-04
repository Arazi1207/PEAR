    // משתנה גלובלי לשמירת המידה שהמשתמש קיבל
    let currentUserSize = null;

    /**
     * =======================================================
     * לוגיקת מחשבון המידות (מסך 1)
     * =======================================================
     */
    const ZARA_SIZE_CHART = [
        { size: 'S', minHeight: 160, maxHeight: 172, minWeight: 55, maxWeight: 65, minChest: 88, maxChest: 94, minWaist: 74, maxWaist: 80, minLegs: 94, maxLegs: 98 },
        { size: 'M', minHeight: 170, maxHeight: 180, minWeight: 65, maxWeight: 76, minChest: 94, maxChest: 102, minWaist: 80, maxWaist: 88, minLegs: 98, maxLegs: 102 },
        { size: 'L', minHeight: 178, maxHeight: 186, minWeight: 75, maxWeight: 87, minChest: 102, maxChest: 110, minWaist: 88, maxWaist: 96, minLegs: 102, maxLegs: 106 },
        { size: 'XL', minHeight: 184, maxHeight: 195, minWeight: 85, maxWeight: 100, minChest: 110, maxChest: 118, minWaist: 96, maxWaist: 106, minLegs: 106, maxLegs: 112 }
    ];

    function renderSizeTable() {
        const tbody = document.getElementById('sizeTableBody');
        tbody.innerHTML = '';
        ZARA_SIZE_CHART.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${row.size}</strong></td>
                <td>${row.minHeight}</td><td>${row.maxHeight}</td>
                <td>${row.minWeight}</td><td>${row.maxWeight}</td>
                <td>${row.minChest}</td><td>${row.maxChest}</td>
                <td>${row.minWaist}</td><td>${row.maxWaist}</td>
                <td>${row.minLegs}</td><td>${row.maxLegs}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function calculateSize() {
        const height = document.getElementById('height').value ? parseFloat(document.getElementById('height').value) : null;
        const weight = document.getElementById('weight').value ? parseFloat(document.getElementById('weight').value) : null;
        const chest = document.getElementById('chest').value ? parseFloat(document.getElementById('chest').value) : null;
        const waist = document.getElementById('waist').value ? parseFloat(document.getElementById('waist').value) : null;
        const legs = document.getElementById('legs').value ? parseFloat(document.getElementById('legs').value) : null;

        const resultBox = document.getElementById('resultBox');
        const sizeResult = document.getElementById('sizeResult');
        const resultLabel = document.getElementById('resultLabel');
        const nextBtn = document.getElementById('btn-next-screen');

        resultBox.classList.remove('show', 'error-result');
        resultLabel.innerText = "המידה המומלצת עבורך:";
        nextBtn.disabled = true;
        currentUserSize = null;

        if (!height || !weight) return;

        if (height > 240 || height < 130 || weight > 220 || weight < 35) {
            resultLabel.innerText = "שגיאה בנתונים:";
            sizeResult.innerText = "נתונים לא הגיוניים";
            resultBox.classList.add('show', 'error-result');
            return;
        }

        let bestSize = "מידה מחוץ לטווח";
        let minPenalty = Infinity;
        const MAX_ALLOWED_PENALTY = 35;

        ZARA_SIZE_CHART.forEach(chartRow => {
            let currentPenalty = 0;
            if (height < chartRow.minHeight) currentPenalty += (chartRow.minHeight - height) * 2;
            if (height > chartRow.maxHeight) currentPenalty += (height - chartRow.maxHeight) * 2;
            if (weight < chartRow.minWeight) currentPenalty += (chartRow.minWeight - weight) * 2;
            if (weight > chartRow.maxWeight) currentPenalty += (weight - chartRow.maxWeight) * 2;

            if (chest) {
                if (chest < chartRow.minChest) currentPenalty += (chartRow.minChest - chest) * 0.5;
                if (chest > chartRow.maxChest) currentPenalty += (chest - chartRow.maxChest) * 0.5;
            }
            if (waist) {
                if (waist < chartRow.minWaist) currentPenalty += (chartRow.minWaist - waist) * 0.5;
                if (waist > chartRow.maxWaist) currentPenalty += (waist - chartRow.maxWaist) * 0.5;
            }
            if (legs) {
                if (legs < chartRow.minLegs) currentPenalty += (chartRow.minLegs - legs) * 0.5;
                if (legs > chartRow.maxLegs) currentPenalty += (legs - chartRow.maxLegs) * 0.5;
            }

            if (currentPenalty < minPenalty) {
                minPenalty = currentPenalty;
                bestSize = chartRow.size;
            }
        });

        if (minPenalty > MAX_ALLOWED_PENALTY) {
            resultLabel.innerText = "תוצאה:";
            sizeResult.innerText = "מידה מחוץ לטווח";
            resultBox.classList.add('show');
        } else {
            sizeResult.innerText = bestSize;
            resultBox.classList.add('show');
            currentUserSize = bestSize;
            nextBtn.disabled = false; // פתיחת הכפתור למעבר למסך הבא
        }
    }

    document.querySelectorAll('#sizeForm input').forEach(input => {
        input.addEventListener('input', calculateSize);
    });

    window.onload = () => {
        renderSizeTable();
        renderCatalog();
    };

    /**
     * =======================================================
     * מעבר בין מסכים
     * =======================================================
     */
    const screenCalc = document.getElementById('screen-calculator');
    const screenFit = document.getElementById('screen-fitting');

    document.getElementById('btn-next-screen').addEventListener('click', () => {
        // עדכון הטקסט של המידה במסך השני
        document.getElementById('final-size-text').innerText = currentUserSize;

        // תג מידה קבוע מעל המצלמה
        const badge = document.getElementById('size-badge');
        badge.innerText = 'המידה שלך: ' + currentUserSize;
        badge.classList.add('show');

        // החלפת מסכים
        screenCalc.classList.remove('active');
        screenFit.classList.add('active');
    });

    document.getElementById('btn-back').addEventListener('click', () => {
        screenFit.classList.remove('active');
        screenCalc.classList.add('active');
    });

    /**
     * =======================================================
     * לוגיקת חדר ההלבשה הוירטואלי (מסך 2)
     * =======================================================
     */
    const WHITE_THRESHOLD = 240;

    const videoElement = document.getElementById('webcam');
    const canvasElement = document.getElementById('output_canvas');
    const ctx = canvasElement.getContext('2d');
    const startBtn = document.getElementById('start-camera');
    const placeholder = document.getElementById('placeholder');

    // Persistent offscreen canvases. White-removal writes directly here; the mesh
    // renderer reads from these (NOT from an <img>) so no PNG round-trip happens.
    const shirtOffscreen = document.createElement('canvas');
    const pantsOffscreen = document.createElement('canvas');
    let shirtLoaded = false;
    let pantsLoaded = false;

    function applyWhiteRemoval(sourceImg, type) {
        const off = (type === 'shirt') ? shirtOffscreen : pantsOffscreen;
        off.width  = sourceImg.naturalWidth  || sourceImg.width;
        off.height = sourceImg.naturalHeight || sourceImg.height;
        const offCtx = off.getContext('2d');
        offCtx.clearRect(0, 0, off.width, off.height);
        offCtx.drawImage(sourceImg, 0, 0, off.width, off.height);

        const imageData = offCtx.getImageData(0, 0, off.width, off.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > WHITE_THRESHOLD && data[i + 1] > WHITE_THRESHOLD && data[i + 2] > WHITE_THRESHOLD) {
                data[i + 3] = 0;
            }
        }
        offCtx.putImageData(imageData, 0, 0);

        if (type === 'shirt') shirtLoaded = true;
        else                  pantsLoaded = true;
    }

    // טעינת בגד מתוך מקור תמונה (קטלוג) והפעלת אותה לוגיקת הסרת רקע
    function loadGarmentFromSrc(src, type) {
        const tempImg = new Image();
        tempImg.crossOrigin = 'anonymous';
        tempImg.onload = () => applyWhiteRemoval(tempImg, type);
        tempImg.src = src;
    }

    // ────────────────────────────────────────────────────────────────────────
    // TASK 1 — 3 fixed shirt archetypes (TANK_TOP, SHORT_SLEEVE, LONG_SLEEVE)
    // Each is a Path2D silhouette in 240x240 SVG coordinates. An uploaded image
    // becomes a fabric TEXTURE filling the archetype's silhouette — the geometry
    // is fixed, only the surface color/texture is user-controlled.
    // ────────────────────────────────────────────────────────────────────────
    const _SHIRT_BODY_FULL = 'M70 55 L90 50 Q120 68 150 50 L170 55 L200 90 L172 112 L172 200 L68 200 L68 112 L40 90 Z';
    const _SHIRT_BODY_TANK = 'M70 55 L90 50 Q120 68 150 50 L170 55 L172 112 L172 200 L68 200 L68 112 Z';
    const _SLEEVE_SHORT_L  = 'M70 55 L40 90 L28 75 L55 42 Z';
    const _SLEEVE_SHORT_R  = 'M170 55 L200 90 L212 75 L185 42 Z';
    const _SLEEVE_LONG_L   = 'M70 55 L40 90 L14 180 L30 185 L55 42 Z';
    const _SLEEVE_LONG_R   = 'M170 55 L200 90 L226 180 L210 185 L185 42 Z';
    function buildShirtSilhouette(archetype) {
        if (archetype === 'sleeveless') return new Path2D(_SHIRT_BODY_TANK);
        if (archetype === 'long')
            return new Path2D(_SLEEVE_LONG_L + ' ' + _SLEEVE_LONG_R + ' ' + _SHIRT_BODY_FULL);
        return new Path2D(_SLEEVE_SHORT_L + ' ' + _SLEEVE_SHORT_R + ' ' + _SHIRT_BODY_FULL);
    }
    // Pants — single silhouette (waistband + two legs joined at crotch)
    const _PANTS_BODY = 'M66 40 L174 40 L174 55 L135 55 L166 212 L128 212 L120 100 L112 212 L74 212 L106 55 L66 55 Z';
    function buildPantsSilhouette() { return new Path2D(_PANTS_BODY); }

    // Composite an uploaded image as a TEXTURE inside the active archetype silhouette.
    // The offscreen canvas dimensions stay at 240x240 so the existing mesh src
    // points (which use 240-space normalized fractions) sample the right regions.
    function applyArchetypeTexture(srcImg, type) {
        const off = (type === 'shirt') ? shirtOffscreen : pantsOffscreen;
        off.width = off.height = 240;
        const c = off.getContext('2d');
        c.clearRect(0, 0, 240, 240);

        const silhouette = (type === 'shirt')
            ? buildShirtSilhouette(currentShirtSleeve || 'short')
            : buildPantsSilhouette();

        // 1) Clip to silhouette, then draw the texture image filling 240x240 with
        //    "cover" semantics so the entire silhouette is covered with pattern.
        c.save();
        c.clip(silhouette);
        const iw = srcImg.naturalWidth  || srcImg.width  || 1;
        const ih = srcImg.naturalHeight || srcImg.height || 1;
        const scale = Math.max(240 / iw, 240 / ih);
        const sw = iw * scale, sh = ih * scale;
        c.drawImage(srcImg, (240 - sw) / 2, (240 - sh) / 2, sw, sh);
        c.restore();

        // 2) Edge stroke — gives the textured fabric a clean defined boundary.
        c.save();
        c.lineWidth = 1.5;
        c.strokeStyle = 'rgba(0, 0, 0, 0.42)';
        c.lineJoin = 'round';
        c.stroke(silhouette);
        c.restore();

        if (type === 'shirt') shirtLoaded = true;
        else                  pantsLoaded = true;
    }

    function setupImageProcessor(inputId, type) {
        document.getElementById(inputId).addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (!file) return;
            // Read the archetype/fit selector BEFORE the texture composite runs.
            if (type === 'shirt') {
                const sel = document.getElementById('shirt-upload-type');
                currentShirtSleeve = sel ? sel.value : 'short';
            } else if (type === 'pants') {
                const sel = document.getElementById('pants-upload-type');
                currentPantsFit = sel ? sel.value : 'regular';
            }
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    // TASK 1 — uploads now overlay as TEXTURE on the active archetype.
                    // No flat-lay assumption; the silhouette is fixed and the user
                    // image fills it.
                    applyArchetypeTexture(img, type);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    setupImageProcessor('shirt-input', 'shirt');
    setupImageProcessor('pants-input', 'pants');

    /**
     * =======================================================
     * קטלוג בגדים (Task 3) — תמונות SVG מוטמעות (ללא API/CORS)
     * =======================================================
     */
    // Color helpers — clamp to 239 so lightened pixels never trigger the >240 white-removal cutoff.
    function _hexToRgb(h){const m=h.replace('#','');return[parseInt(m.slice(0,2),16),parseInt(m.slice(2,4),16),parseInt(m.slice(4,6),16)];}
    function _toHex(r,g,b){const c=v=>Math.max(0,Math.min(239,Math.round(v))).toString(16).padStart(2,'0');return '#'+c(r)+c(g)+c(b);}
    function _lighten(hex,p){const[r,g,b]=_hexToRgb(hex);return _toHex(r+(239-r)*p,g+(239-g)*p,b+(239-b)*p);}
    function _darken(hex,p){const[r,g,b]=_hexToRgb(hex);return _toHex(r*(1-p),g*(1-p),b*(1-p));}

    // FIX 4 — shirtSVG now accepts a pattern param so visuals match catalog names:
    //   'plain'   → solid colored shirt
    //   'polo'    → vertical placket + 2 small buttons at the collar
    //   'stripes' → 5 horizontal contrasting bands across the torso
    function shirtSVG(color, sleeveType, pattern) {
        sleeveType = sleeveType || 'short';
        pattern = pattern || 'plain';
        const top    = _lighten(color, 0.15);
        const bottom = _darken (color, 0.15);
        const dark   = _darken (color, 0.25);
        const edge   = _darken (color, 0.30);
        const collar = _lighten(color, 0.10);
        const seam   = _darken (color, 0.40);
        const fold   = _darken (color, 0.35);   // fold-line color (subtle, opacity 0.08)
        // Body path now uses the rounded crew-neck notch (no spike).
        const path   = 'M58 55 L90 50 Q120 68 150 50 L182 55 L200 90 L182 112 L182 200 L58 200 L58 112 L40 90 Z';
        const id = 'g' + Math.random().toString(36).slice(2, 8);

        // Sleeves: curved edges + natural taper, anchored to the SAME shoulder
        // points (70,55) / (170,55) as the body so there is NO gap at the seam.
        let sleeves = '';
        let foldLines = '';
        if (sleeveType === 'short') {
            // Left: shoulder(70,55) → cuff-inner(40,90) curved, around cuff to (28,75), curved up to shoulder-outer(55,42), back to (70,55).
            sleeves += `<path d='M70 55 Q52 70 40 90 Q34 86 28 75 Q42 56 55 42 Q62 48 70 55 Z' fill='url(#vL${id})' stroke='${edge}' stroke-width='1.4' stroke-linejoin='round'/>`;
            sleeves += `<path d='M170 55 Q188 70 200 90 Q206 86 212 75 Q198 56 185 42 Q178 48 170 55 Z' fill='url(#vR${id})' stroke='${edge}' stroke-width='1.4' stroke-linejoin='round'/>`;
            foldLines += `<g opacity='0.08' stroke='${fold}' stroke-width='1' fill='none'>`
                +   `<path d='M62 50 Q52 68 42 84'/>`
                +   `<path d='M58 46 Q48 64 38 80'/>`
                +   `<path d='M178 50 Q188 68 198 84'/>`
                +   `<path d='M182 46 Q192 64 202 80'/>`
                + `</g>`;
        } else if (sleeveType === 'long') {
            // Long sleeve — thicker bicep, gentle taper to wrist. Joins flush at
            // (68,58) / (172,58) which sit inside the body silhouette, so the body
            // path (drawn after) covers the attachment seam cleanly.
            sleeves += `<path d='M68 58 L55 42 L22 175 L42 188 L58 115 L68 90 Z' fill='url(#vL${id})' stroke='${edge}' stroke-width='1.4' stroke-linejoin='round'/>`;
            sleeves += `<path d='M172 58 L185 42 L218 175 L198 188 L182 115 L172 90 Z' fill='url(#vR${id})' stroke='${edge}' stroke-width='1.4' stroke-linejoin='round'/>`;
            foldLines += `<g opacity='0.08' stroke='${fold}' stroke-width='1' fill='none'>`
                +   `<path d='M60 55 Q40 120 22 178'/>`
                +   `<path d='M55 50 Q35 115 18 175'/>`
                +   `<path d='M180 55 Q200 120 218 178'/>`
                +   `<path d='M185 50 Q205 115 222 175'/>`
                + `</g>`;
        }

        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<rect width='240' height='240' fill='#ffffff'/>`
            + `<defs>`
            +   `<linearGradient id='v${id}' x1='0' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bottom}'/>`
            +   `</linearGradient>`
            +   `<linearGradient id='vL${id}' x1='1' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bottom}'/>`
            +   `</linearGradient>`
            +   `<linearGradient id='vR${id}' x1='0' y1='0' x2='1' y2='1'>`
            +     `<stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bottom}'/>`
            +   `</linearGradient>`
            +   `<radialGradient id='r${id}' cx='0.5' cy='0.55' r='0.55'>`
            +     `<stop offset='0.45' stop-color='${color}' stop-opacity='0'/>`
            +     `<stop offset='1' stop-color='${dark}' stop-opacity='0.55'/>`
            +   `</radialGradient>`
            +   `<pattern id='weave${id}' x='0' y='0' width='6' height='6' patternUnits='userSpaceOnUse'>`
            +     `<rect width='6' height='6' fill='${color}'/>`
            +     `<line x1='0' y1='0' x2='6' y2='6' stroke='${_darken(color,0.08)}' stroke-width='0.3' opacity='0.25'/>`
            +     `<line x1='6' y1='0' x2='0' y2='6' stroke='${_lighten(color,0.06)}' stroke-width='0.3' opacity='0.15'/>`
            +   `</pattern>`
            + `</defs>`
            + sleeves
            + `<path d='${path}' fill='url(#weave${id})' stroke='${edge}' stroke-width='1.5' stroke-linejoin='round'/>`
            + `<path d='${path}' fill='url(#r${id})'/>`
            // crew-neck collar — flat rounded neckline (no spike)
            + `<path d='M90 50 Q120 68 150 50 L148 60 Q120 76 92 60 Z' fill='${collar}' stroke='${edge}' stroke-width='1' stroke-linejoin='round'/>`
            + `<path d='M93 60 Q120 72 147 60' fill='none' stroke='${seam}' stroke-width='1' opacity='0.55'/>`
            + foldLines
            // FIX 4 — pattern overlays so visuals match catalog names
            + (pattern === 'polo'
                ? `<line x1='120' y1='72' x2='120' y2='115' stroke='${seam}' stroke-width='1.6' opacity='0.85'/>`
                  + `<circle cx='120' cy='86'  r='2.2' fill='${_lighten(color, 0.25)}' stroke='${edge}' stroke-width='0.8'/>`
                  + `<circle cx='120' cy='102' r='2.2' fill='${_lighten(color, 0.25)}' stroke='${edge}' stroke-width='0.8'/>`
                : '')
            + (pattern === 'stripes'
                ? `<g opacity='0.85'>`
                  + `<rect x='42'  y='95'  width='156' height='8' fill='${_lighten(color, 0.55)}'/>`
                  + `<rect x='44'  y='125' width='152' height='8' fill='${_lighten(color, 0.55)}'/>`
                  + `<rect x='46'  y='155' width='148' height='8' fill='${_lighten(color, 0.55)}'/>`
                  + `<rect x='48'  y='185' width='144' height='8' fill='${_lighten(color, 0.55)}'/>`
                  + `</g>`
                : '')
            + `<g opacity='0.06' stroke='#000' stroke-width='1'>`
            +   `<line x1='50' y1='90'  x2='190' y2='90' />`
            +   `<line x1='52' y1='115' x2='188' y2='115'/>`
            +   `<line x1='54' y1='140' x2='186' y2='140'/>`
            +   `<line x1='56' y1='165' x2='184' y2='165'/>`
            +   `<line x1='58' y1='185' x2='182' y2='185'/>`
            + `</g>`
            + `</svg>`;
    }

    function pantsSVG(color) {
        const top    = _lighten(color, 0.15);
        const bottom = _darken (color, 0.15);
        const dark   = _darken (color, 0.25);
        const edge   = _darken (color, 0.30);
        const seam   = _darken (color, 0.45);
        const pocket = _darken (color, 0.20);
        const knee   = _darken (color, 0.10);   // 10% darker for knee-bend shading
        // Two-leg path: waistband (66-174 @ y=40-55) + two tapered legs joined at crotch (120,100).
        const path   = 'M58 40 L182 40 L182 55 L145 55 L176 212 L138 212 L120 100 L102 212 L64 212 L96 55 L58 55 Z';
        const id = 'g' + Math.random().toString(36).slice(2, 8);
        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<rect width='240' height='240' fill='#ffffff'/>`
            + `<defs>`
            +   `<linearGradient id='v${id}' x1='0' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bottom}'/>`
            +   `</linearGradient>`
            +   `<radialGradient id='r${id}' cx='0.5' cy='0.5' r='0.55'>`
            +     `<stop offset='0.45' stop-color='${color}' stop-opacity='0'/>`
            +     `<stop offset='1' stop-color='${dark}' stop-opacity='0.55'/>`
            +   `</radialGradient>`
            +   `<pattern id='denim${id}' x='0' y='0' width='3' height='6' patternUnits='userSpaceOnUse'>`
            +     `<rect width='3' height='6' fill='${color}'/>`
            +     `<line x1='0' y1='0' x2='0' y2='6' stroke='${_lighten(color,0.10)}' stroke-width='0.8' opacity='0.5'/>`
            +     `<line x1='1.5' y1='0' x2='1.5' y2='6' stroke='${_darken(color,0.08)}' stroke-width='0.5' opacity='0.4'/>`
            +   `</pattern>`
            + `</defs>`
            + `<path d='${path}' fill='url(#denim${id})' stroke='${edge}' stroke-width='1.5' stroke-linejoin='round'/>`
            + `<path d='${path}' fill='url(#r${id})'/>`
            // waistband band
            + `<rect x='66' y='40' width='108' height='10' fill='${pocket}' opacity='0.55'/>`
            // center seam (waistband → crotch) and inner-leg seams
            + `<line x1='120' y1='40' x2='120' y2='96' stroke='${seam}' stroke-width='1.2' opacity='0.75'/>`
            + `<line x1='120' y1='96' x2='128' y2='212' stroke='${seam}' stroke-width='1' opacity='0.55'/>`
            + `<line x1='120' y1='96' x2='112' y2='212' stroke='${seam}' stroke-width='1' opacity='0.55'/>`
            // pockets near top
            + `<rect x='74'  y='54' width='28' height='18' rx='2' fill='none' stroke='${seam}' stroke-width='1' opacity='0.7'/>`
            + `<rect x='138' y='54' width='28' height='18' rx='2' fill='none' stroke='${seam}' stroke-width='1' opacity='0.7'/>`
            // knee-area shading — 10% darker bands centered on the knee bend (y≈130)
            + `<defs>`
            +   `<radialGradient id='kL${id}' cx='0.5' cy='0.5' r='0.5'>`
            +     `<stop offset='0' stop-color='${knee}' stop-opacity='0.55'/>`
            +     `<stop offset='1' stop-color='${knee}' stop-opacity='0'/>`
            +   `</radialGradient>`
            +   `<radialGradient id='kR${id}' cx='0.5' cy='0.5' r='0.5'>`
            +     `<stop offset='0' stop-color='${knee}' stop-opacity='0.55'/>`
            +     `<stop offset='1' stop-color='${knee}' stop-opacity='0'/>`
            +   `</radialGradient>`
            + `</defs>`
            + `<ellipse cx='92'  cy='130' rx='22' ry='14' fill='url(#kL${id})'/>`
            + `<ellipse cx='148' cy='130' rx='22' ry='14' fill='url(#kR${id})'/>`
            + `</svg>`;
    }

    function svgToDataUri(svg) {
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    // TASK 2 — Unified catalog. Every shirt entry uses ONE of the 3 archetypes
    // (sleeveless / short / long); colors vary, silhouettes match the archetype.
    // No mismatched styles (polo, stripes, photo-uploads) — uniform e-commerce feel.
    const GARMENT_CATALOG = [
        // Tank tops (sleeveless archetype)
        { name: 'גופייה שחורה',       type: 'shirt', color: '#1a1a22', sleeve: 'sleeveless' },
        { name: 'גופייה לבנה',         type: 'shirt', color: '#dad4c4', sleeve: 'sleeveless' },
        { name: 'גופייה נייבי',        type: 'shirt', color: '#27496d', sleeve: 'sleeveless' },
        // Short sleeve
        { name: 'חולצה קצרה נייבי',   type: 'shirt', color: '#27496d', sleeve: 'short' },
        { name: 'חולצה קצרה ירוקה',   type: 'shirt', color: '#2f5233', sleeve: 'short' },
        { name: 'חולצה קצרה שחורה',   type: 'shirt', color: '#1a1a22', sleeve: 'short' },
        // Long sleeve
        { name: 'חולצה ארוכה בורדו',  type: 'shirt', color: '#7a2d3b', sleeve: 'long' },
        { name: 'חולצה ארוכה אפורה',  type: 'shirt', color: '#3a3a4a', sleeve: 'long' },
        { name: 'חולצה ארוכה לבנה',   type: 'shirt', color: '#dad4c4', sleeve: 'long' },
        // Pants (single archetype; fit modes are width-only)
        { name: 'ג׳ינס כחול',          type: 'pants', color: '#34495e' },
        { name: 'מכנסיים שחורים',     type: 'pants', color: '#222a33' },
        { name: 'מכנסי חאקי',          type: 'pants', color: '#8b7355' },
        { name: 'מכנסי אפור',          type: 'pants', color: '#4a4a55' },
    ];

    // Active shirt's sleeve type — drives sleeve mesh quads in onResults().
    let currentShirtSleeve = 'short';
    // Active pants fit — drives leg-width scaling and inner-gap clamp.
    // FIX 1 — All three values lifted substantially. The old 0.92/1.00/1.14 band
    // pushed the outer leg edge no further out than the hip landmark, which made
    // the pants look like leggings on a normal frame. The new values give pants
    // the visible coverage of real garments (regular ≈ +25% beyond the hip line).
    let currentPantsFit = 'regular';
    const PANTS_FIT_SCALE = { slim: 1.25, regular: 1.45, wide: 1.70 };
    // Cache last stable knee positions so a brief landmark loss doesn't collapse legs.
    const _pantsCache = { lKnee: null, rKnee: null };

    // FIX 5 — reorder the in-memory catalog so items matching the picked subtype
    // (sleeve for shirts, fit for pants) come first, then re-render the affected
    // grid. The clicked card keeps its .selected state across the re-render.
    function sortCatalogBySubtype(picked) {
        const key = picked.type === 'shirt' ? 'sleeve' : 'fit';
        const pickedKey = picked[key];
        const sameType    = GARMENT_CATALOG.filter(i => i.type === picked.type);
        const otherType   = GARMENT_CATALOG.filter(i => i.type !== picked.type);
        sameType.sort((a, b) => {
            const am = (a[key] === pickedKey) ? 0 : 1;
            const bm = (b[key] === pickedKey) ? 0 : 1;
            return am - bm;
        });
        // Rebuild list in place: shirts first or pants first per original ordering.
        GARMENT_CATALOG.length = 0;
        if (picked.type === 'shirt') GARMENT_CATALOG.push(...sameType, ...otherType);
        else                          GARMENT_CATALOG.push(...otherType, ...sameType);
        renderCatalog(picked);
    }

    function renderCatalog(selected) {
        const shirtGrid = document.getElementById('catalog-shirts');
        const pantsGrid = document.getElementById('catalog-pants');
        shirtGrid.innerHTML = '';
        pantsGrid.innerHTML = '';

        GARMENT_CATALOG.forEach(item => {
            const card = document.createElement('div');
            card.className = 'catalog-card';
            card.dataset.type = item.type;
            if (selected && item === selected) card.classList.add('selected');
            const img = document.createElement('img');
            if (item.src) {
                img.src = item.src;
                img.crossOrigin = 'anonymous';
            } else {
                const svg = item.type === 'shirt'
                    ? shirtSVG(item.color, item.sleeve)   // uniform 'plain' style across catalog
                    : pantsSVG(item.color);
                img.src = svgToDataUri(svg);
            }
            img.alt = item.name;
            const span = document.createElement('span');
            span.innerText = item.name;
            card.appendChild(img);
            card.appendChild(span);

            card.addEventListener('click', () => {
                if (item.src) {
                    loadGarmentFromSrc(item.src, item.type);
                } else {
                    const svg = item.type === 'shirt'
                        ? shirtSVG(item.color, item.sleeve)
                        : pantsSVG(item.color);
                    loadGarmentFromSrc(svgToDataUri(svg), item.type);
                }
                if (item.type === 'shirt') currentShirtSleeve = item.sleeve || 'short';
                else                       currentPantsFit    = item.fit    || 'regular';
                placeholder.innerText = 'בגד נבחר — לחץ על כפתור המצלמה';
                // FIX 5 — reorder the grid so items of the SAME subtype as the
                // clicked item bubble to the top of the category.
                sortCatalogBySubtype(item);
            });

            (item.type === 'shirt' ? shirtGrid : pantsGrid).appendChild(card);
        });
    }

    // === Size multiplier: garment width scales with calculated size ===
    const SIZE_MULTIPLIERS = { 'XS': 0.90, 'S': 0.96, 'M': 1.00, 'L': 1.07, 'XL': 1.15, 'XXL': 1.24 };

    // === Exponential smoothing — eliminates landmark jitter ===
    const _sm = {};
    function applySmooth(key, raw, alpha) {
        if (!_sm[key]) { _sm[key] = { x: raw.x, y: raw.y }; return { x: raw.x, y: raw.y, v: raw.v }; }
        _sm[key].x = alpha * raw.x + (1 - alpha) * _sm[key].x;
        _sm[key].y = alpha * raw.y + (1 - alpha) * _sm[key].y;
        return { x: _sm[key].x, y: _sm[key].y, v: raw.v };
    }

    // === Triangle affine warp (3×3 mesh → 8 triangles per garment) ===
    function solveAffine(s, d) {
        const det = s[0][0]*(s[1][1]-s[2][1]) + s[1][0]*(s[2][1]-s[0][1]) + s[2][0]*(s[0][1]-s[1][1]);
        if (Math.abs(det) < 1e-8) return null;
        const a0 = [s[1][1]-s[2][1], s[2][1]-s[0][1], s[0][1]-s[1][1]];
        const a1 = [s[2][0]-s[1][0], s[0][0]-s[2][0], s[1][0]-s[0][0]];
        const a2 = [s[1][0]*s[2][1]-s[2][0]*s[1][1], s[2][0]*s[0][1]-s[0][0]*s[2][1], s[0][0]*s[1][1]-s[1][0]*s[0][1]];
        const dot = (row, v) => (row[0]*v[0] + row[1]*v[1] + row[2]*v[2]) / det;
        const dx = [d[0][0],d[1][0],d[2][0]], dy = [d[0][1],d[1][1],d[2][1]];
        return [dot(a0,dx), dot(a0,dy), dot(a1,dx), dot(a1,dy), dot(a2,dx), dot(a2,dy)];
    }

    function drawWarpedTri(img, src, dst) {
        const m = solveAffine(src, dst);
        if (!m) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(dst[0][0], dst[0][1]);
        ctx.lineTo(dst[1][0], dst[1][1]);
        ctx.lineTo(dst[2][0], dst[2][1]);
        ctx.closePath();
        ctx.clip();
        // setTransform OVERWRITES the matrix (vs transform which multiplies).
        // Required: dst points are already in canvas space, no compounding wanted.
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
    }

    function drawMeshWarped(img, srcPts, dstPts) {
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 2; c++) {
                const i00=r*3+c, i01=r*3+c+1, i10=(r+1)*3+c, i11=(r+1)*3+c+1;
                drawWarpedTri(img, [srcPts[i00],srcPts[i01],srcPts[i10]], [dstPts[i00],dstPts[i01],dstPts[i10]]);
                drawWarpedTri(img, [srcPts[i01],srcPts[i11],srcPts[i10]], [dstPts[i01],dstPts[i11],dstPts[i10]]);
            }
        }
    }

    // 2-col × 3-row grid (6 pts → 4 triangles). Used for per-leg pants warp.
    function drawMeshWarped6(img, srcPts, dstPts) {
        for (let r = 0; r < 2; r++) {
            const i00 = r*2, i01 = r*2 + 1, i10 = (r+1)*2, i11 = (r+1)*2 + 1;
            drawWarpedTri(img, [srcPts[i00], srcPts[i01], srcPts[i10]],
                                [dstPts[i00], dstPts[i01], dstPts[i10]]);
            drawWarpedTri(img, [srcPts[i01], srcPts[i11], srcPts[i10]],
                                [dstPts[i01], dstPts[i11], dstPts[i10]]);
        }
    }

    // Sleeve direction cache — used to fall back gracefully when an elbow landmark
    // visibility drops, and to smooth jitter frame-to-frame.
    const _sleeveCache = { L: null, R: null };

    // Multi-segment sleeve warp — 4 rings (shoulder → cuff) split into 3 quads
    // (6 triangles total). Width tapers linearly so the cuff is narrower than the
    // shoulder cap, avoiding the "rigid plank" look of a single quad.
    //
    // type: 'short' | 'long' | 'sleeveless' (sleeveless skips entirely)
    // elbowVis: raw visibility 0..1 — drives the cached-direction fallback.
    function drawSleeveQuad(side, type, imgW, imgH, shoulder, elbow, shoulderWidth, elbowVis) {
        if (type === 'sleeveless') return;

        // Direction shoulder→elbow with clamping + EMA smoothing + low-vis fallback.
        let dx, dy;
        const cached = _sleeveCache[side];
        if (elbowVis < 0.50 && cached) {
            // Low confidence — keep using last stable arm direction.
            dx = cached.dx;
            dy = cached.dy;
        } else {
            const rawDx = elbow.x - shoulder.x;
            const rawDy = elbow.y - shoulder.y;
            const rawLen = Math.hypot(rawDx, rawDy) || 1;
            // Clamp arm length to a sane band relative to the torso so a noisy elbow
            // cannot stretch the sleeve into a thin ribbon.
            const minLen = shoulderWidth * 0.55;
            const maxLen = shoulderWidth * 1.80;
            const clampedLen = Math.max(minLen, Math.min(maxLen, rawLen));
            let cdx = rawDx / rawLen * clampedLen;
            let cdy = rawDy / rawLen * clampedLen;
            if (cached) {
                const a = 0.40; // EMA: 40% new + 60% old
                cdx = a * cdx + (1 - a) * cached.dx;
                cdy = a * cdy + (1 - a) * cached.dy;
            }
            dx = cdx; dy = cdy;
            _sleeveCache[side] = { dx, dy };
        }

        const dlen = Math.hypot(dx, dy) || 1;
        // Outward perpendicular (push AWAY from torso). Sign flips per body side.
        const sign = (side === 'L') ? 1 : -1;
        const px =  dy / dlen * sign;
        const py = -dx / dlen * sign;

        // Sleeve end parameter along shoulder→elbow: short stops at mid-bicep.
        const tEnd = (type === 'long') ? 1.00 : 0.92;
        // FIX 2 — Width raised significantly. Real upper-arm circumference is
        // ~35-45% of shoulder width, so the cap needs that much fabric to wrap
        // around the arm instead of sitting on it like a ribbon. Forearm/cuff
        // is narrower than bicep, but still substantial.
        const wCap  = shoulderWidth * 0.75;
        const wCuff = shoulderWidth * (type === 'long' ? 0.48 : 0.58);

        // 6 rings (5 quads) at t = 0, 1/5, 2/5, 3/5, 4/5, 1 — denser sampling
        // eliminates the visible gap between adjacent rings on long sleeves.
        const rings = [];
        for (let i = 0; i < 6; i++) {
            const f = i / 5;
            const t = tEnd * f;
            const w = wCap + (wCuff - wCap) * f;
            const cxR = shoulder.x + dx * t;
            const cyR = shoulder.y + dy * t;
            // Sleeve straddles the arm centerline: inner shifted body-side by 0.55w,
            // outer shifted away-side by 0.45w. Total width 1.0w, but the pivot now
            // sits OVER the arm so the underside is covered (no exposed skin).
            const inner = [cxR - px * w * 0.55, cyR - py * w * 0.55];
            const outer = [cxR + px * w * 0.45, cyR + py * w * 0.45];
            rings.push({ inner, outer });
        }

        // Source rings — sample the sleeve quadrilateral in the flat-lay SVG.
        // Long sleeves use the elongated quad (down to y≈0.77); short stops near y≈0.38.
        const longSleeve = (type === 'long');
        let sIT, sOT, sIE, sOE;
        if (side === 'L') {
            sIT = [0.292*imgW, 0.229*imgH]; sOT = [0.229*imgW, 0.175*imgH];
            sIE = longSleeve ? [0.125*imgW, 0.771*imgH] : [0.167*imgW, 0.375*imgH];
            sOE = longSleeve ? [0.058*imgW, 0.750*imgH] : [0.117*imgW, 0.313*imgH];
        } else {
            sIT = [0.708*imgW, 0.229*imgH]; sOT = [0.771*imgW, 0.175*imgH];
            sIE = longSleeve ? [0.875*imgW, 0.771*imgH] : [0.833*imgW, 0.375*imgH];
            sOE = longSleeve ? [0.942*imgW, 0.750*imgH] : [0.883*imgW, 0.313*imgH];
        }
        const srcRings = [];
        for (let i = 0; i < 6; i++) {
            const f = i / 5;
            const inner = [sIT[0] + (sIE[0] - sIT[0]) * f, sIT[1] + (sIE[1] - sIT[1]) * f];
            const outer = [sOT[0] + (sOE[0] - sOT[0]) * f, sOT[1] + (sOE[1] - sOT[1]) * f];
            srcRings.push({ inner, outer });
        }

        // 5 quads → 10 triangles. Triangle order matches drawMeshWarped's diagonal.
        for (let i = 0; i < 5; i++) {
            const a = srcRings[i],   b = srcRings[i + 1];
            const A = rings[i],      B = rings[i + 1];
            drawWarpedTri(shirtOffscreen,
                [a.inner, a.outer, b.inner],
                [A.inner, A.outer, B.inner]);
            drawWarpedTri(shirtOffscreen,
                [a.outer, b.outer, b.inner],
                [A.outer, B.outer, B.inner]);
        }
    }

    // === Multiply-blend shadow under armpits for depth realism ===
    function drawArmpitShadow(lApt, rApt, sw) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        [lApt, rApt].forEach(apt => {
            ctx.beginPath();
            ctx.ellipse(apt.x, apt.y, sw * 0.12, sw * 0.26, 0, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
    }

    function onResults(results) {
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(results.image, -canvasElement.width, 0, canvasElement.width, canvasElement.height);
        ctx.restore();

        if (!results.poseLandmarks) return;

        const lm = results.poseLandmarks;
        const W = canvasElement.width, H = canvasElement.height;
        const raw = (i) => ({ x: (1 - lm[i].x) * W, y: lm[i].y * H, v: lm[i].visibility });

        // Smooth all used landmarks (alpha: 0.35 for body, 0.50 for elbows = faster arm response)
        const lShoulder = applySmooth('lS', raw(11), 0.35);
        const rShoulder = applySmooth('rS', raw(12), 0.35);
        const lElbow    = applySmooth('lE', raw(13), 0.50);
        const rElbow    = applySmooth('rE', raw(14), 0.50);
        const lHip      = applySmooth('lH', raw(23), 0.35);
        const rHip      = applySmooth('rH', raw(24), 0.35);
        const lKnee     = applySmooth('lK', raw(25), 0.35);
        const rKnee     = applySmooth('rK', raw(26), 0.35);
        const nose      = applySmooth('no', raw(0),  0.30);
        const lAnkle    = applySmooth('lA', raw(27), 0.35);
        const rAnkle    = applySmooth('rA', raw(28), 0.35);

        // Per-landmark visibility gates (stricter than group checks)
        const rawLSv = raw(11).v, rawRSv = raw(12).v;
        const rawLHv = raw(23).v, rawRHv = raw(24).v;
        const torsoVis = rawLSv > 0.7 && rawRSv > 0.7 && rawLHv > 0.7 && rawRHv > 0.7;
        const hipVis   = rawLHv > 0.7 && rawRHv > 0.7;
        const elbowVis = raw(13).v > 0.65 && raw(14).v > 0.65;
        const kneeVis  = raw(25).v > 0.65 && raw(26).v > 0.65;

        if (!shirtLoaded && !pantsLoaded) return;

        // Torso geometry
        const sCenter = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2 };
        const hCenter = { x: (lHip.x + rHip.x) / 2,          y: (lHip.y + rHip.y) / 2          };
        const tVx = hCenter.x - sCenter.x, tVy = hCenter.y - sCenter.y;
        const torsoLen = Math.hypot(tVx, tVy) || 1;
        const along = (pt, t) => ({ x: pt.x + tVx * t, y: pt.y + tVy * t });

        // Distance-aware: user pixel height from nose to mid-ankle
        const ankleVis = raw(27).v > 0.5 || raw(28).v > 0.5;
        const midAnkle = ankleVis
            ? { x: (lAnkle.x + rAnkle.x) / 2, y: (lAnkle.y + rAnkle.y) / 2 }
            : { x: hCenter.x, y: hCenter.y + torsoLen * 1.8 };
        const userPixH = Math.hypot(nose.x - midAnkle.x, nose.y - midAnkle.y) || H;

        // Distance factor — keeps fit consistent whether user is close or far from camera.
        // Reference: body fills ~75% of canvas height. Clamp to avoid extreme deformation.
        const distanceFactor = Math.min(1.15, Math.max(0.88, userPixH / (H * 0.75)));

        // Orientation: sideways when shoulder span < 15% of pixel height
        const shoulderWidth = Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y);
        const isSideways = (shoulderWidth / userPixH) < 0.15;
        const sideScale  = isSideways ? 0.5 : 1.0;

        const scaleX = (cx, px, s) => cx + (px - cx) * s;

        let shirtBottomY = hCenter.y;

        // ── SHIRT ────────────────────────────────────────────────────────────
        if (shirtLoaded && torsoVis) {
            const imgW = shirtOffscreen.width  || 240;
            const imgH = shirtOffscreen.height || 240;

            const sizeScale = SIZE_MULTIPLIERS[currentUserSize] || 1.00;
            const hScale    = sizeScale * sideScale * distanceFactor;
            // TASK 1 — Top row of the mesh uses a tighter scale than the torso so
            // the collar never spreads past the actual shoulder landmarks during a
            // head turn (which is when the previous top edge looked like it grew
            // past the user's face). Hard-clamped to 1.02 — any extra width must
            // come from the middle/bottom rows where it doesn't visually invade the
            // neck/face region.
            const topHScale = Math.min(hScale, 1.02);

            // 9 destination control points anchored to body landmarks
            // TASK 1 — collar position: blend between sCenter (purely "between
            // shoulders") and the geometric base-of-neck (0.08 torso below). The
            // 50/50 blend keeps the collar opening pinned to the clavicle line
            // regardless of how the shoulder line tilts when the user turns.
            const neckPt = along(sCenter, -0.22);
            const lApt   = along(lShoulder,  0.25);     // 25% torso below lShoulder = left armpit
            const rApt   = along(rShoulder,  0.25);
            const tCtr   = { x: (sCenter.x + hCenter.x) / 2, y: (sCenter.y + hCenter.y) / 2 };

            // Elbow influence: deform armpit toward arm direction when arms are visible
            let alx = lApt.x, aly = lApt.y, arx = rApt.x, ary = rApt.y;
            if (elbowVis && !isSideways) {
                alx += (lElbow.x - lShoulder.x) * 0.28;
                aly += (lElbow.y - lShoulder.y) * 0.14;
                arx += (rElbow.x - rShoulder.x) * 0.28;
                ary += (rElbow.y - rShoulder.y) * 0.14;
            }

            const cx = sCenter.x;
            const dst = [
                // TASK 1 — top row uses topHScale (≤1.02) so shoulder corners stay
                // anchored to the actual shoulder line; no horizontal overflow into
                // the face region during turns.
                [scaleX(cx, lShoulder.x, topHScale), lShoulder.y],
                [neckPt.x,                            neckPt.y  ],
                [scaleX(cx, rShoulder.x, topHScale), rShoulder.y],
                [scaleX(cx, alx,         hScale),    aly         ],
                [tCtr.x,                              tCtr.y    ],
                [scaleX(cx, arx,         hScale),    ary         ],
                [scaleX(cx, lHip.x,      hScale),    lHip.y      ],
                [hCenter.x,                           hCenter.y  ],
                [scaleX(cx, rHip.x,      hScale),    rHip.y      ],
            ];

            // Source control points on the flat-lay garment image (normalized fractions)
            // Matched to shirt SVG path: shoulders @ y≈55 (0.23), armpits @ y≈112 (0.47), hem @ y=200 (0.83).
            const src = [
                [0.29*imgW, 0.23*imgH], [0.50*imgW, 0.17*imgH], [0.71*imgW, 0.23*imgH],
                [0.28*imgW, 0.47*imgH], [0.50*imgW, 0.43*imgH], [0.72*imgW, 0.47*imgH],
                [0.29*imgW, 0.83*imgH], [0.50*imgW, 0.83*imgH], [0.71*imgW, 0.83*imgH],
            ];

            drawArmpitShadow({ x: alx, y: aly }, { x: arx, y: ary }, shoulderWidth);

            // Sleeves drawn BEFORE torso so the shirt body renders ON TOP of the
            // sleeves when arms are down (otherwise sleeves would hide the shirt body).
            if (!isSideways && currentShirtSleeve !== 'sleeveless') {
                const lEv = raw(13).v, rEv = raw(14).v;
                drawSleeveQuad('L', currentShirtSleeve, imgW, imgH, lShoulder, lElbow, shoulderWidth, lEv);
                drawSleeveQuad('R', currentShirtSleeve, imgW, imgH, rShoulder, rElbow, shoulderWidth, rEv);
            }

            drawMeshWarped(shirtOffscreen, src, dst);

            shirtBottomY = (dst[6][1] + dst[7][1] + dst[8][1]) / 3;
        }

        // ── PANTS ────────────────────────────────────────────────────────────
        if (pantsLoaded && hipVis) {
            const imgW = pantsOffscreen.width  || 240;
            const imgH = pantsOffscreen.height || 240;

            // Knee anchor — extrapolate when invisible. Cache last stable knees so
            // brief tracking losses don't collapse the leg geometry.
            let lKneePt = kneeVis ? lKnee : (_pantsCache.lKnee || along(lHip, 1.2));
            let rKneePt = kneeVis ? rKnee : (_pantsCache.rKnee || along(rHip, 1.2));
            if (kneeVis) { _pantsCache.lKnee = lKnee; _pantsCache.rKnee = rKnee; }
            const kCtr    = { x: (lKneePt.x + rKneePt.x) / 2, y: (lKneePt.y + rKneePt.y) / 2 };

            // Ankle anchor — extrapolate below knee if not visible
            const lBot = raw(27).v > 0.5 ? lAnkle
                : { x: lKneePt.x + (lKneePt.x - lHip.x) * 0.7, y: lKneePt.y + (lKneePt.y - lHip.y) * 0.7 };
            const rBot = raw(28).v > 0.5 ? rAnkle
                : { x: rKneePt.x + (rKneePt.x - rHip.x) * 0.7, y: rKneePt.y + (rKneePt.y - rHip.y) * 0.7 };
            const bCtr = { x: (lBot.x + rBot.x) / 2, y: (lBot.y + rBot.y) / 2 };

            // Stitch pants top to shirt bottom edge (small overlap = tucked-in look)
            const pantsTopY = shirtLoaded ? Math.min(shirtBottomY + 2, hCenter.y + 4) : hCenter.y;

            const fitScale = PANTS_FIT_SCALE[currentPantsFit] || 1.00;
            const pScale = sideScale * (SIZE_MULTIPLIERS[currentUserSize] || 1.00) * distanceFactor * fitScale;
            const cx = hCenter.x;

            // FIX 1 — Inner-edge gap raised from ~4% to ~12% of hip span. The inner
            // column now sits well across the body center so each leg has visible
            // crotch coverage. Knee/ankle gaps stay close to the hip gap (no aggressive
            // taper) so the leg doesn't pinch into a cone toward the floor.
            const hipSpan = Math.abs(lHip.x - rHip.x) || 1;
            const baseGap = Math.max(8, hipSpan * 0.08);
            const fitBias = (currentPantsFit === 'slim' ? 0.85
                          : currentPantsFit === 'wide' ? 1.35 : 1.00);
            const gapHip  = baseGap * fitBias;
            const gapKnee = gapHip  * 1.00;
            const gapAnk  = gapHip  * 0.95;

            // Two-leg system: each leg warps independently so it follows its own knee + ankle.
            // Column order per leg: row entry 0 = outer edge, entry 1 = inner edge (near body center).
            // FIX 1 — src x-range moved INSIDE the actual SVG leg shape (x≈0.28–0.46 left,
            // x≈0.54–0.72 right). The old range (0.06–0.45) sampled mostly transparent
            // background outside the leg, which is why pants rendered as a thin strip
            // — half the fabric was missing.
            const leftLegSrc = [
                [0.28*imgW, 0.18*imgH], [0.46*imgW, 0.18*imgH],
                [0.30*imgW, 0.50*imgH], [0.46*imgW, 0.50*imgH],
                [0.31*imgW, 0.88*imgH], [0.46*imgW, 0.88*imgH],
            ];
            const hipSpanFull   = (Math.abs(lHip.x    - rHip.x   ) / 2) * pScale * 1.20;
            const kneeSpanFull  = (Math.abs(lKneePt.x - rKneePt.x) / 2) * pScale * 1.05;
            const ankleSpanFull = (Math.abs(lBot.x    - rBot.x   ) / 2) * pScale * 0.90;
            const leftLegDst = [
                [cx - hipSpanFull,    pantsTopY],
                [cx - gapHip,         pantsTopY],
                [cx - kneeSpanFull,   lKneePt.y],
                [cx - gapKnee,        kCtr.y   ],
                [cx - ankleSpanFull,  lBot.y   ],
                [cx - gapAnk,         bCtr.y   ],
            ];

            // FIX 1 — mirror of leftLegSrc, inside the right leg shape.
            const rightLegSrc = [
                [0.54*imgW, 0.18*imgH], [0.72*imgW, 0.18*imgH],
                [0.54*imgW, 0.50*imgH], [0.70*imgW, 0.50*imgH],
                [0.54*imgW, 0.88*imgH], [0.69*imgW, 0.88*imgH],
            ];
            const rightLegDst = [
                [cx + gapHip,         pantsTopY],
                [cx + hipSpanFull,    pantsTopY],
                [cx + gapKnee,        kCtr.y   ],
                [cx + kneeSpanFull,   rKneePt.y],
                [cx + gapAnk,         bCtr.y   ],
                [cx + ankleSpanFull,  rBot.y   ],
            ];

            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            const waistW = hipSpanFull * 2 + gapHip * 2;
            ctx.fillRect(cx - waistW/2, pantsTopY - 8, waistW, 12);
            ctx.restore();

            drawMeshWarped6(pantsOffscreen, leftLegSrc,  leftLegDst);
            drawMeshWarped6(pantsOffscreen, rightLegSrc, rightLegDst);
        }
    }

    const pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    pose.setOptions({
        modelComplexity: 2,
        smoothLandmarks: true,
        enableSegmentation: true,
        smoothSegmentation: true,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    pose.onResults(onResults);

    const previewSection = document.getElementById('previewSection');

    function startCamera() {
        if (startBtn.disabled && previewSection.classList.contains('loading')) return;
        placeholder.style.display = 'none';
        startBtn.innerText = "טוען מודל AI...";
        startBtn.disabled = true;
        previewSection.classList.add('loading');

        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await pose.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });

        camera.start().then(() => {
            startBtn.innerText = "מערכת מדידה פעילה";
            previewSection.classList.remove('loading');
            previewSection.classList.add('scanning');
            const fab = document.getElementById('fab');
            if (fab) fab.classList.add('hidden');
        }).catch(err => {
            alert("שגיאה בגישה למצלמה: " + err);
            startBtn.innerText = "שגיאה בהפעלה";
            startBtn.disabled = false;
            previewSection.classList.remove('loading');
        });
    }

    startBtn.addEventListener('click', startCamera);
    document.getElementById('fab').addEventListener('click', startCamera);

    /**
     * =======================================================
     * UI redesign — progress, validity, screen slide, FAB, fullscreen
     * =======================================================
     */
    function updateProgressAndValidity() {
        const fields = ['height', 'weight', 'chest', 'waist', 'legs'];
        let validMandatory = 0;
        fields.forEach(id => {
            const el = document.getElementById(id);
            const group = el ? el.closest('.form-group') : null;
            if (!el || !group) return;
            const v = parseFloat(el.value);
            const min = parseFloat(el.min), max = parseFloat(el.max);
            const ok = !isNaN(v) && v >= min && v <= max;
            group.classList.toggle('valid', ok);
            if (ok && ['height', 'weight'].includes(id)) validMandatory++;
        });
        const pct = Math.round((validMandatory / 2) * 100);
        const fill = document.getElementById('progressFill');
        const lbl  = document.getElementById('progressPercent');
        if (fill) fill.style.width = pct + '%';
        if (lbl)  lbl.innerText = pct + '%';
    }
    document.querySelectorAll('#sizeForm input').forEach(input => {
        input.addEventListener('input', updateProgressAndValidity);
    });

    // Pop animation on size result change
    const _sizeResultEl = document.getElementById('sizeResult');
    let _lastSize = _sizeResultEl.innerText;
    new MutationObserver(() => {
        const cur = _sizeResultEl.innerText;
        if (cur && cur !== '-' && cur !== _lastSize) {
            _sizeResultEl.classList.remove('pop');
            void _sizeResultEl.offsetWidth; // restart animation
            _sizeResultEl.classList.add('pop');
            _lastSize = cur;
        }
    }).observe(_sizeResultEl, { childList: true, characterData: true, subtree: true });

    // Screen slide direction — augment existing handlers
    const _nextBtn = document.getElementById('btn-next-screen');
    const _backBtn = document.getElementById('btn-back');
    _nextBtn.addEventListener('click', () => {
        screenFit.classList.remove('slide-in-from-left');
        screenFit.classList.add('slide-in-from-right');
    });
    _backBtn.addEventListener('click', () => {
        screenCalc.classList.remove('slide-in-from-right');
        screenCalc.classList.add('slide-in-from-left');
        // Reset camera-preview overlay state on return
        previewSection.classList.remove('scanning', 'loading');
    });

    // Fullscreen toggle on the preview
    document.getElementById('fsBtn').addEventListener('click', () => {
        const target = previewSection;
        if (!document.fullscreenElement) {
            (target.requestFullscreen ||
             target.webkitRequestFullscreen ||
             target.msRequestFullscreen).call(target);
        } else {
            (document.exitFullscreen ||
             document.webkitExitFullscreen ||
             document.msExitFullscreen).call(document);
        }
    });
