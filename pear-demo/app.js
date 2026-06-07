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

        // אם המשתמש הגיע מדף מוצר בחנות — הפעל את הפריט הממוקד עכשיו
        // (אחרי שהושלם חישוב המידה במסך 1).
        if (typeof activateFocusFitting === 'function') activateFocusFitting();
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

        const W = off.width, H = off.height;
        const imageData = offCtx.getImageData(0, 0, W, H);
        const data = imageData.data;

        // BFS flood-fill from all 4 image borders.
        // Only removes white/near-white pixels that are spatially connected to
        // the edge of the image (the actual background). Interior highlights or
        // near-white fabric regions that are fully surrounded by garment pixels
        // are preserved, eliminating halos and jagged border artifacts.
        // Threshold matches WHITE_THRESHOLD (240) so procedural SVG pixels
        // clamped to ≤239 are never incorrectly erased.
        const BG = WHITE_THRESHOLD;  // 240 — must beat original to keep parity
        const visited = new Uint8Array(W * H);
        const queue   = new Int32Array(W * H);
        let qHead = 0, qTail = 0;

        const enqueue = (idx) => {
            if (visited[idx]) return;
            const p = idx * 4;
            if (data[p] > BG && data[p+1] > BG && data[p+2] > BG) {
                visited[idx] = 1;
                queue[qTail++] = idx;
            }
        };

        // Seed from all four edges
        for (let x = 0; x < W; x++) { enqueue(x); enqueue((H-1)*W + x); }
        for (let y = 1; y < H-1; y++) { enqueue(y*W); enqueue(y*W + W-1); }

        // 4-connected BFS expansion
        while (qHead < qTail) {
            const idx = queue[qHead++];
            const x = idx % W, y = (idx / W) | 0;
            if (x > 0)   enqueue(idx - 1);
            if (x < W-1) enqueue(idx + 1);
            if (y > 0)   enqueue(idx - W);
            if (y < H-1) enqueue(idx + W);
        }

        // Erase background + 1-px feathered boundary to kill anti-alias halos.
        for (let i = 0; i < W * H; i++) {
            const p = i * 4;
            if (visited[i]) {
                data[p+3] = 0;
            } else {
                // Soft-clip: any pixel touching a removed pixel gets its alpha
                // reduced in proportion to how close it is to white — dissolves
                // the residual semi-transparent fringe without touching the garment.
                const x = i % W, y = (i / W) | 0;
                const touchesBg =
                    (x > 0   && visited[i-1]) ||
                    (x < W-1 && visited[i+1]) ||
                    (y > 0   && visited[i-W]) ||
                    (y < H-1 && visited[i+W]);
                if (touchesBg) {
                    const w = Math.min(data[p], data[p+1], data[p+2]) / 255;
                    data[p+3] = Math.round(data[p+3] * (1 - w * 0.80));
                }
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

        c.save();
        c.clip(silhouette);

        // ── 1. Base layer: uploaded photo, cover-fit scaled ───────────
        const iw = srcImg.naturalWidth  || srcImg.width  || 1;
        const ih = srcImg.naturalHeight || srcImg.height || 1;
        const scale = Math.max(240 / iw, 240 / ih);
        const sw = iw * scale, sh = ih * scale;
        c.drawImage(srcImg, (240 - sw) / 2, (240 - sh) / 2, sw, sh);

        // ── 2. Multiply pass — shadows darken without adding hue ──────
        // All gradient fills below are clipped to the silhouette and
        // composited as multiply (result = photo × gradient / 255).
        // rgba(255,255,255,0) is transparent white → multiply = no change.
        c.globalCompositeOperation = 'multiply';

        // Perimeter vignette — fabric wraps away from viewer at edges
        const vignette = c.createRadialGradient(120, 120, 48, 120, 120, 138);
        vignette.addColorStop(0.30, 'rgba(255,255,255,0)');
        vignette.addColorStop(0.72, 'rgba(165,165,165,1)');
        vignette.addColorStop(1.00, 'rgba(110,110,110,1)');
        c.fillStyle = vignette;
        c.fillRect(0, 0, 240, 240);

        // Left-side curvature shadow
        const leftShadow = c.createLinearGradient(0, 0, 240, 0);
        leftShadow.addColorStop(0,    'rgba(100,100,100,1)');
        leftShadow.addColorStop(0.20, 'rgba(210,210,210,1)');
        leftShadow.addColorStop(0.38, 'rgba(255,255,255,0)');
        c.fillStyle = leftShadow;
        c.globalAlpha = 0.55;
        c.fillRect(0, 0, 240, 240);

        // Right-side curvature shadow
        const rightShadow = c.createLinearGradient(240, 0, 0, 0);
        rightShadow.addColorStop(0,    'rgba(100,100,100,1)');
        rightShadow.addColorStop(0.20, 'rgba(210,210,210,1)');
        rightShadow.addColorStop(0.38, 'rgba(255,255,255,0)');
        c.fillStyle = rightShadow;
        c.fillRect(0, 0, 240, 240);
        c.globalAlpha = 1;

        // Bottom hem/ankle shadow — fabric weight pulling down
        const hemShadow = c.createLinearGradient(0, 0, 0, 240);
        hemShadow.addColorStop(0.70, 'rgba(255,255,255,0)');
        hemShadow.addColorStop(1.00, 'rgba(115,115,115,1)');
        c.fillStyle = hemShadow;
        c.globalAlpha = 0.60;
        c.fillRect(0, 0, 240, 240);
        c.globalAlpha = 1;

        // ── 3. Screen pass — shoulder/chest highlight ─────────────────
        // screen = 1-(1-src)(1-dst); lightens only; preserves colour
        c.globalCompositeOperation = 'screen';

        const shoulderHL = c.createRadialGradient(120, 52, 6, 120, 52, 108);
        shoulderHL.addColorStop(0,   'rgba(255,255,255,0.18)');
        shoulderHL.addColorStop(0.6, 'rgba(255,255,255,0.04)');
        shoulderHL.addColorStop(1,   'rgba(255,255,255,0)');
        c.fillStyle = shoulderHL;
        c.fillRect(0, 0, 240, 240);

        // ── 4. Overlay pass — micro-contrast boost ───────────────────
        // overlay pops weave/texture detail in the mid-tones
        c.globalCompositeOperation = 'overlay';

        const foldAccent = c.createLinearGradient(0, 50, 0, 210);
        foldAccent.addColorStop(0,    'rgba(255,255,255,0.08)');
        foldAccent.addColorStop(0.45, 'rgba(255,255,255,0)');
        foldAccent.addColorStop(1,    'rgba(0,0,0,0.10)');
        c.fillStyle = foldAccent;
        c.fillRect(0, 0, 240, 240);

        c.restore(); // resets clip, compositeOperation, and globalAlpha

        // ── 5. Edge stroke — clean garment boundary ───────────────────
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

    // shirtSVG visual overhaul — hyper-realistic fabric textures, multi-layer shading, stitching detail.
    // Mechanics (mesh source points, silhouette paths) are unchanged.
    //   'plain'   → solid colored shirt
    //   'polo'    → vertical placket + 2 small buttons at the collar
    //   'stripes' → 5 horizontal contrasting bands across the torso
    function shirtSVG(color, sleeveType, pattern) {
        sleeveType = sleeveType || 'short';
        pattern    = pattern    || 'plain';

        // ── Derived colour palette ────────────────────────────────────────
        const hi      = _lighten(color, 0.28);   // specular highlight
        const top     = _lighten(color, 0.18);   // top shading stop
        const mid     = _lighten(color, 0.06);   // mid-tone stop
        const bot     = _darken (color, 0.20);   // bottom shading stop
        const dark    = _darken (color, 0.30);   // shadow tone
        const vdark   = _darken (color, 0.45);   // deep shadow / edge
        const edge    = _darken (color, 0.35);   // outline stroke
        const collar  = _lighten(color, 0.10);   // collar fill
        const seam    = _darken (color, 0.48);   // stitch / seam lines
        const thread  = _darken (color, 0.12);   // warp thread shadow
        const threadH = _lighten(color, 0.18);   // weft thread highlight

        const path = 'M58 55 L90 50 Q120 68 150 50 L182 55 C198 62 204 80 200 90 C197 101 190 109 182 112 L182 200 L58 200 L58 112 C50 109 43 101 40 90 C36 80 42 62 58 55 Z';
        const id   = 'g' + Math.random().toString(36).slice(2, 8);

        // ── Sleeves, cuff stitching, fold lines ──────────────────────────
        let sleeves = '', foldLines = '', cuffDetails = '';

        if (sleeveType === 'short') {
            // Cylindrical sleeve cap — wider at the armhole attachment,
            // tapers to a curved hem. Cubic bezier outer edge bows slightly
            // outward to suggest the roundness of the arm underneath.
            sleeves =
                `<path d='M40 55 C28 62 24 78 26 98 C27 102 30 106 34 108 L52 108 C56 106 59 102 60 98 C62 78 62 62 58 55 Z' fill='url(#vSl${id})' stroke='${edge}' stroke-width='1' stroke-linejoin='round'/>`
              + `<path d='M200 55 C212 62 216 78 214 98 C213 102 210 106 206 108 L188 108 C184 106 181 102 180 98 C178 78 178 62 182 55 Z' fill='url(#vSl${id})' stroke='${edge}' stroke-width='1' stroke-linejoin='round'/>`;
            // Double-stitch hem following the curved cuff line
            cuffDetails = `<g fill='none' stroke='${seam}' stroke-width='0.65' opacity='0.55'>`
                + `<path d='M26 98 C27 102 30 106 34 108 L52 108 C56 106 59 102 60 98'/>`
                + `<path d='M27 95 C28 99 31 103 35 105 L51 105 C55 103 58 99 59 95'/>`
                + `<path d='M214 98 C213 102 210 106 206 108 L188 108 C184 106 181 102 180 98'/>`
                + `<path d='M213 95 C212 99 209 103 205 105 L189 105 C185 103 182 99 181 95'/>`
                + `</g>`;
            // Cylindrical fold lines — arc with the sleeve curvature.
            // Shadow on near-body edge, highlight at apex, shadow on far edge.
            foldLines = `<g fill='none'>`
                + `<path d='M29 64 C28 78 27 92 29 104' stroke='${dark}' stroke-width='0.8' opacity='0.22'/>`
                + `<path d='M37 60 C36 76 35 90 36 104' stroke='${hi}'   stroke-width='0.5' opacity='0.16'/>`
                + `<path d='M55 60 C56 76 57 90 56 104' stroke='${dark}' stroke-width='0.7' opacity='0.18'/>`
                + `<path d='M211 64 C212 78 213 92 211 104' stroke='${dark}' stroke-width='0.8' opacity='0.22'/>`
                + `<path d='M203 60 C204 76 205 90 204 104' stroke='${hi}'   stroke-width='0.5' opacity='0.16'/>`
                + `<path d='M185 60 C184 76 183 90 184 104' stroke='${dark}' stroke-width='0.7' opacity='0.18'/>`
                + `</g>`;
        } else if (sleeveType === 'long') {
            sleeves = `<path d='M58 55 L42 55 L22 195 L44 210 L58 105 Z' fill='url(#vSlL${id})' stroke='${edge}' stroke-width='1'/>`
                    + `<path d='M182 55 L198 55 L218 195 L196 210 L182 105 Z' fill='url(#vSlR${id})' stroke='${edge}' stroke-width='1'/>`;
            // Rib-knit cuff block — filled band with hand-fitted rib lines.
            // Cuff quads derived from the sleeve wrist corners (see sleeve path).
            // Left wrist: outer(22,195) inner(44,210) → top of band 15px up the sleeve.
            // Right wrist: outer(218,195) inner(196,210) → mirrored.
            const _cuff = _darken(color, 0.12);
            cuffDetails =
                // ── Left cuff ──────────────────────────────────────────
                `<path d='M24 179 L46 194 L44 212 L22 197 Z' fill='${_cuff}' stroke='${edge}' stroke-width='0.9' stroke-linejoin='round'/>`
                + `<g fill='none' stroke='${seam}' stroke-width='0.75' opacity='0.52'>`
                + `<line x1='24' y1='183' x2='44' y2='197'/>`
                + `<line x1='24' y1='187' x2='44' y2='201'/>`
                + `<line x1='24' y1='191' x2='44' y2='205'/>`
                + `</g>`
                + `<g fill='none' stroke='${hi}' stroke-width='0.38' opacity='0.28'>`
                + `<line x1='24' y1='185' x2='44' y2='199'/>`
                + `<line x1='24' y1='189' x2='44' y2='203'/>`
                + `<line x1='24' y1='193' x2='44' y2='207'/>`
                + `</g>`
                + `<line x1='24' y1='179' x2='46' y2='194' stroke='${seam}' stroke-width='0.7' opacity='0.65'/>`
                // ── Right cuff (mirror of left) ────────────────────────
                + `<path d='M216 179 L194 194 L196 212 L218 197 Z' fill='${_cuff}' stroke='${edge}' stroke-width='0.9' stroke-linejoin='round'/>`
                + `<g fill='none' stroke='${seam}' stroke-width='0.75' opacity='0.52'>`
                + `<line x1='216' y1='183' x2='196' y2='197'/>`
                + `<line x1='216' y1='187' x2='196' y2='201'/>`
                + `<line x1='216' y1='191' x2='196' y2='205'/>`
                + `</g>`
                + `<g fill='none' stroke='${hi}' stroke-width='0.38' opacity='0.28'>`
                + `<line x1='216' y1='185' x2='196' y2='199'/>`
                + `<line x1='216' y1='189' x2='196' y2='203'/>`
                + `<line x1='216' y1='193' x2='196' y2='207'/>`
                + `</g>`
                + `<line x1='216' y1='179' x2='194' y2='194' stroke='${seam}' stroke-width='0.7' opacity='0.65'/>`;
            // Long curved fold pairs along full sleeve length
            foldLines = `<g fill='none'>`
                + `<path d='M50 60 Q38 128 28 198' stroke='${dark}' stroke-width='0.8' opacity='0.18'/>`
                + `<path d='M52 62 Q40 130 30 200' stroke='${hi}'   stroke-width='0.5' opacity='0.12'/>`
                + `<path d='M46 60 Q32 126 22 196' stroke='${dark}' stroke-width='0.5' opacity='0.12'/>`
                + `<path d='M190 60 Q202 128 212 198' stroke='${dark}' stroke-width='0.8' opacity='0.18'/>`
                + `<path d='M188 62 Q200 130 210 200' stroke='${hi}'   stroke-width='0.5' opacity='0.12'/>`
                + `<path d='M194 60 Q208 126 218 196' stroke='${dark}' stroke-width='0.5' opacity='0.12'/>`
                + `</g>`;
        }

        // Body drape folds — cubic-bezier paths simulate gravity-driven fabric.
        // Each shadow+highlight pair forms a "fold unit": the shadow marks the
        // valley where the fabric bends away; the highlight sits on the ridge.
        // Control points bulge outward at mid-torso (fabric gathered at sides)
        // and converge toward the hem (weight pulls fabric downward and inward).
        const bodyFolds = `<g fill='none'>`
            // Left-side main drape: bows out at mid-chest, returns at hem
            + `<path d='M85 72 C82 108 79 150 85 195' stroke='${dark}' stroke-width='0.90' opacity='0.16'/>`
            + `<path d='M88 72 C85 110 83 152 88 195' stroke='${hi}'   stroke-width='0.55' opacity='0.10'/>`
            // Mid-left tension crease: subtle inward curve from chest taper
            + `<path d='M108 68 C104 112 106 154 108 196' stroke='${dark}' stroke-width='0.72' opacity='0.12'/>`
            // Centre seam shadow — very subtle bilateral axis
            + `<path d='M120 72 C119 118 121 158 120 196' stroke='${dark}' stroke-width='0.45' opacity='0.07'/>`
            // Mid-right tension crease: mirror of mid-left
            + `<path d='M132 68 C136 112 134 154 132 196' stroke='${dark}' stroke-width='0.72' opacity='0.12'/>`
            // Right-side main drape: mirror of left
            + `<path d='M152 72 C156 108 158 150 152 195' stroke='${dark}' stroke-width='0.90' opacity='0.16'/>`
            + `<path d='M155 72 C158 110 160 152 155 195' stroke='${hi}'   stroke-width='0.55' opacity='0.10'/>`
            + `</g>`;

        // Side seam double-stitch lines
        const sideSeams = `<g fill='none' stroke='${seam}' stroke-width='0.65' opacity='0.38'>`
            + `<path d='M60 112 L60 196'/>`
            + `<path d='M63 112 L63 196'/>`
            + `<path d='M180 112 L180 196'/>`
            + `<path d='M177 112 L177 196'/>`
            + `</g>`;

        // Hem double-stitch + running-stitch pattern overlay
        const hemDetails = `<g fill='none' stroke='${seam}' stroke-width='0.65' opacity='0.42'>`
            + `<line x1='60' y1='195' x2='180' y2='195'/>`
            + `<line x1='60' y1='198' x2='180' y2='198'/>`
            + `</g>`
            + `<rect x='61' y='193' width='118' height='6' fill='url(#stitch${id})' opacity='0.30'/>`;

        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<rect width='240' height='240' fill='#ffffff'/>`
            + `<defs>`

            // ── Gradients ────────────────────────────────────────────────
            // Body: 3-stop top→mid→bottom for smooth tonal shading
            +   `<linearGradient id='v${id}' x1='0' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0'   stop-color='${top}'/>`
            +     `<stop offset='0.4' stop-color='${mid}'/>`
            +     `<stop offset='1'   stop-color='${bot}'/>`
            +   `</linearGradient>`
            // Short sleeve — horizontal cylindrical shading (light apex, dark at edges)
            // so the sleeve reads as a round arm cross-section, not a flat plank.
            +   `<linearGradient id='vSl${id}' x1='0' y1='0' x2='1' y2='0'>`
            +     `<stop offset='0'    stop-color='${_darken(color, 0.26)}'/>`
            +     `<stop offset='0.30' stop-color='${top}'/>`
            +     `<stop offset='0.55' stop-color='${hi}' stop-opacity='0.70'/>`
            +     `<stop offset='0.75' stop-color='${top}'/>`
            +     `<stop offset='1'    stop-color='${_darken(color, 0.28)}'/>`
            +   `</linearGradient>`
            // Long sleeve left — diagonal matches arm taper direction
            +   `<linearGradient id='vSlL${id}' x1='1' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0' stop-color='${top}'/>`
            +     `<stop offset='1' stop-color='${_darken(color, 0.25)}'/>`
            +   `</linearGradient>`
            // Long sleeve right — mirrored diagonal
            +   `<linearGradient id='vSlR${id}' x1='0' y1='0' x2='1' y2='1'>`
            +     `<stop offset='0' stop-color='${top}'/>`
            +     `<stop offset='1' stop-color='${_darken(color, 0.25)}'/>`
            +   `</linearGradient>`
            // Edge vignette — 3-stop radial, punchy at extreme edges
            +   `<radialGradient id='r${id}' cx='0.5' cy='0.50' r='0.60'>`
            +     `<stop offset='0.25' stop-color='${color}' stop-opacity='0'/>`
            +     `<stop offset='0.72' stop-color='${dark}'  stop-opacity='0.28'/>`
            +     `<stop offset='1'    stop-color='${vdark}' stop-opacity='0.58'/>`
            +   `</radialGradient>`
            // Left-side shadow — simulates torso curvature (fabric wraps around body)
            +   `<linearGradient id='lSide${id}' x1='0' y1='0' x2='1' y2='0'>`
            +     `<stop offset='0'    stop-color='${vdark}' stop-opacity='0.40'/>`
            +     `<stop offset='0.22' stop-color='${dark}'  stop-opacity='0.08'/>`
            +     `<stop offset='0.35' stop-color='${color}' stop-opacity='0'/>`
            +   `</linearGradient>`
            // Right-side shadow — mirror of left
            +   `<linearGradient id='rSide${id}' x1='1' y1='0' x2='0' y2='0'>`
            +     `<stop offset='0'    stop-color='${vdark}' stop-opacity='0.40'/>`
            +     `<stop offset='0.22' stop-color='${dark}'  stop-opacity='0.08'/>`
            +     `<stop offset='0.35' stop-color='${color}' stop-opacity='0'/>`
            +   `</linearGradient>`
            // Shoulder highlight — simulates overhead light source
            +   `<radialGradient id='hl${id}' cx='0.5' cy='0.20' r='0.42'>`
            +     `<stop offset='0' stop-color='${hi}'    stop-opacity='0.30'/>`
            +     `<stop offset='1' stop-color='${color}' stop-opacity='0'/>`
            +   `</radialGradient>`
            // Chest highlight — subtle fabric surface bulge at pectoral region
            +   `<radialGradient id='chHL${id}' cx='0.5' cy='0.48' r='0.30'>`
            +     `<stop offset='0' stop-color='${hi}'    stop-opacity='0.16'/>`
            +     `<stop offset='1' stop-color='${color}' stop-opacity='0'/>`
            +   `</radialGradient>`
            // Hem shadow — bottom edge darkens like fabric hanging under gravity
            +   `<linearGradient id='hemSh${id}' x1='0' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0.72' stop-color='${color}' stop-opacity='0'/>`
            +     `<stop offset='1'    stop-color='${vdark}' stop-opacity='0.38'/>`
            +   `</linearGradient>`

            // ── Woven cotton texture ─────────────────────────────────────
            // 4×4 tile: alternating warp (vertical) and weft (horizontal)
            // thread lines with highlight/shadow pairs + checkerboard gloss
            +   `<pattern id='weave${id}' x='0' y='0' width='4' height='4' patternUnits='userSpaceOnUse'>`
            +     `<rect width='4' height='4' fill='${color}'/>`
            +     `<line x1='0.5' y1='0' x2='0.5' y2='4' stroke='${threadH}' stroke-width='0.9' opacity='0.22'/>`
            +     `<line x1='2.0' y1='0' x2='2.0' y2='4' stroke='${thread}'  stroke-width='0.8' opacity='0.14'/>`
            +     `<line x1='3.5' y1='0' x2='3.5' y2='4' stroke='${threadH}' stroke-width='0.6' opacity='0.10'/>`
            +     `<line x1='0' y1='0.5' x2='4' y2='0.5' stroke='${thread}'  stroke-width='0.8' opacity='0.14'/>`
            +     `<line x1='0' y1='2.0' x2='4' y2='2.0' stroke='${threadH}' stroke-width='0.6' opacity='0.10'/>`
            +     `<line x1='0' y1='3.5' x2='4' y2='3.5' stroke='${thread}'  stroke-width='0.5' opacity='0.08'/>`
            +     `<rect x='0' y='0' width='2' height='2' fill='${threadH}' opacity='0.06'/>`
            +     `<rect x='2' y='2' width='2' height='2' fill='${threadH}' opacity='0.06'/>`
            +   `</pattern>`

            // Running-stitch tile for hem overlay
            +   `<pattern id='stitch${id}' x='0' y='0' width='5' height='6' patternUnits='userSpaceOnUse'>`
            +     `<line x1='1' y1='0' x2='3' y2='3' stroke='${seam}' stroke-width='0.7'/>`
            +     `<line x1='3' y1='3' x2='1' y2='6' stroke='${seam}' stroke-width='0.7'/>`
            +   `</pattern>`

            // ── Fabric surface filter ────────────────────────────────────
            // Stage 1: fractalNoise displacement simulates woven micro-relief.
            // Stage 2: feDiffuseLighting treats the noise as a bump map so
            //   individual threads catch directional light (woven cotton look).
            // Stage 3: arithmetic composite — 85% warped texture + 25% diffuse.
            +   `<filter id='fab${id}' x='-2%' y='-2%' width='104%' height='104%' color-interpolation-filters='sRGB'>`
            +     `<feTurbulence type='fractalNoise' baseFrequency='0.65 0.32' numOctaves='4' seed='11' result='noise'/>`
            +     `<feDisplacementMap in='SourceGraphic' in2='noise' scale='2.4' xChannelSelector='R' yChannelSelector='G' result='warped'/>`
            +     `<feDiffuseLighting in='warped' surfaceScale='1.8' diffuseConstant='0.85' lighting-color='white' result='diffuse'>`
            +       `<feDistantLight azimuth='315' elevation='55'/>`
            +     `</feDiffuseLighting>`
            +     `<feComposite in='warped' in2='diffuse' operator='arithmetic' k1='0' k2='0.85' k3='0.25' k4='0'/>`
            +   `</filter>`

            + `</defs>`

            // ── Render order ─────────────────────────────────────────────
            // Layer 1 — sleeves (behind body silhouette)
            + sleeves
            // Layer 2 — shoulder connector patches
            + `<rect x='52' y='54' width='40' height='20' rx='5' fill='url(#v${id})' stroke='${edge}' stroke-width='0.8'/>`
            + `<rect x='148' y='54' width='40' height='20' rx='5' fill='url(#v${id})' stroke='${edge}' stroke-width='0.8'/>`
            // Layer 3 — body base: woven texture with fabric displacement
            + `<path d='${path}' fill='url(#weave${id})' filter='url(#fab${id})' stroke='${edge}' stroke-width='1.5' stroke-linejoin='round'/>`
            // Layer 4 — tonal gradient overlay (reveals depth without killing texture)
            + `<path d='${path}' fill='url(#v${id})' opacity='0.45'/>`
            // Layer 5 — side curvature shadows (left and right independently)
            + `<path d='${path}' fill='url(#lSide${id})'/>`
            + `<path d='${path}' fill='url(#rSide${id})'/>`
            // Layer 6 — edge vignette (deepens perimeter)
            + `<path d='${path}' fill='url(#r${id})'/>`
            // Layer 7 — shoulder + chest highlights (simulates overhead diffuse light)
            + `<path d='${path}' fill='url(#hl${id})'/>`
            + `<path d='${path}' fill='url(#chHL${id})'/>`
            // Layer 8 — hem shadow (fabric weight pulling downward)
            + `<path d='${path}' fill='url(#hemSh${id})'/>`
            // Layer 9 — crew-neck collar with cubic-bezier inner band + rib-knit lines.
            // Outer edge follows body neckline exactly (Q120 68).
            // Inner band: cubic bezier drops to y≈73 at centre then rises back up,
            // giving the collar proper volume vs. the old flat quadratic shape.
            + `<path d='M90 50 Q120 68 150 50 L148 58 C142 68 120 73 98 68 C93 64 91 59 91 54 Z' fill='${collar}' stroke='${edge}' stroke-width='1' stroke-linejoin='round'/>`
            + `<path d='M93 58 C100 70 120 74 147 58' fill='none' stroke='${seam}' stroke-width='1'   opacity='0.55'/>`
            + `<path d='M94 54 Q120 68 146 54' fill='none' stroke='${seam}' stroke-width='0.6' opacity='0.30'/>`
            + `<path d='M96 52 Q120 64 144 52' fill='none' stroke='${seam}' stroke-width='0.4' opacity='0.20'/>`
            // Layer 10 — structural details: seams, folds, cuff, hem stitching
            + sideSeams
            + bodyFolds
            + foldLines
            + cuffDetails
            + hemDetails
            // Layer 11 — pattern overlays (polo / stripes)
            + (pattern === 'polo'
                ? `<line x1='120' y1='72' x2='120' y2='115' stroke='${seam}' stroke-width='1.6' opacity='0.85'/>`
                  + `<line x1='117' y1='72' x2='117' y2='115' stroke='${seam}' stroke-width='0.8' opacity='0.40'/>`
                  + `<line x1='123' y1='72' x2='123' y2='115' stroke='${seam}' stroke-width='0.8' opacity='0.40'/>`
                  + `<circle cx='120' cy='87'  r='2.4' fill='${_lighten(color, 0.35)}' stroke='${edge}' stroke-width='0.8'/>`
                  + `<circle cx='120' cy='101' r='2.4' fill='${_lighten(color, 0.35)}' stroke='${edge}' stroke-width='0.8'/>`
                  + `<circle cx='120' cy='87'  r='1.0' fill='${seam}' opacity='0.55'/>`
                  + `<circle cx='120' cy='101' r='1.0' fill='${seam}' opacity='0.55'/>`
                : '')
            + (pattern === 'stripes'
                ? `<g opacity='0.82'>`
                  + `<rect x='42'  y='95'  width='156' height='8' fill='${_lighten(color, 0.55)}' rx='1'/>`
                  + `<rect x='44'  y='125' width='152' height='8' fill='${_lighten(color, 0.55)}' rx='1'/>`
                  + `<rect x='46'  y='155' width='148' height='8' fill='${_lighten(color, 0.55)}' rx='1'/>`
                  + `<rect x='48'  y='182' width='144' height='7' fill='${_lighten(color, 0.55)}' rx='1'/>`
                  + `</g>`
                : '')
            + `</svg>`;
    }

    function pantsSVG(color) {
        const hi      = _lighten(color, 0.28);   // thigh/front face specular
        const top     = _lighten(color, 0.15);   // waist shading
        const mid     = _lighten(color, 0.05);   // mid-tone
        const bot     = _darken (color, 0.22);   // cuff/ankle shading
        const dark    = _darken (color, 0.28);   // shadow tone
        const vdark   = _darken (color, 0.45);   // deep shadow
        const edge    = _darken (color, 0.35);   // outline stroke
        const waist   = _darken (color, 0.18);   // waistband fill
        const seam    = _darken (color, 0.48);   // stitch/seam lines
        const fade    = _lighten(color, 0.32);   // whisker/fade highlights
        const thread  = _darken (color, 0.12);   // warp thread shadow
        const threadH = _lighten(color, 0.18);   // weft thread highlight
        // Tapered trapezoid legs with a crotch gusset — replaces disconnected
        // rectangles so the silhouette is a proper connected pants shape.
        // Key Y anchors: waistband 40-56, thigh 56-92, knee 92-130, calf 130-157, hem 212.
        const path =
              'M66 40 L174 40 L174 56 L66 56 Z'
            + ' M70 56 L116 56 L114 92 L112 130 L110 157 L108 212 L78 212 L76 157 L74 130 L74 92 Z'
            + ' M124 56 L170 56 L170 92 L168 130 L166 157 L162 212 L132 212 L130 157 L128 130 L126 92 Z'
            + ' M114 56 L126 56 L128 92 L112 92 Z';
        const id = 'g' + Math.random().toString(36).slice(2, 8);

        const whiskerL =
              `<line x1='80' y1='127' x2='106' y2='120' stroke='${fade}' stroke-width='1.4' opacity='0.22'/>`
            + `<line x1='82' y1='132' x2='108' y2='125' stroke='${fade}' stroke-width='0.8' opacity='0.14'/>`
            + `<line x1='84' y1='136' x2='108' y2='130' stroke='${fade}' stroke-width='0.6' opacity='0.10'/>`;
        const whiskerR =
              `<line x1='134' y1='127' x2='160' y2='120' stroke='${fade}' stroke-width='1.4' opacity='0.22'/>`
            + `<line x1='132' y1='132' x2='158' y2='125' stroke='${fade}' stroke-width='0.8' opacity='0.14'/>`
            + `<line x1='130' y1='136' x2='156' y2='130' stroke='${fade}' stroke-width='0.6' opacity='0.10'/>`;

        const legFolds = `<g fill='none'>`
            + `<path d='M93 60 Q92 100 93 128' stroke='${dark}' stroke-width='0.75' opacity='0.16'/>`
            + `<path d='M95 60 Q94 100 95 128' stroke='${hi}'   stroke-width='0.50' opacity='0.11'/>`
            + `<path d='M100 60 Q102 95 100 128' stroke='${dark}' stroke-width='0.55' opacity='0.10'/>`
            + `<path d='M143 60 Q144 100 143 128' stroke='${dark}' stroke-width='0.75' opacity='0.16'/>`
            + `<path d='M145 60 Q146 100 145 128' stroke='${hi}'   stroke-width='0.50' opacity='0.11'/>`
            + `<path d='M150 60 Q148 95 150 128' stroke='${dark}' stroke-width='0.55' opacity='0.10'/>`
            + `<path d='M90 157 Q89 178 90 207' stroke='${dark}' stroke-width='0.55' opacity='0.12'/>`
            + `<path d='M143 157 Q144 178 143 207' stroke='${dark}' stroke-width='0.55' opacity='0.12'/>`
            + `</g>`;

        const seamLines = `<g fill='none' stroke='${seam}' stroke-width='0.65' opacity='0.40'>`
            + `<line x1='77' y1='55' x2='77' y2='130'/>`
            + `<line x1='80' y1='130' x2='82' y2='155'/>`
            + `<line x1='82' y1='155' x2='82' y2='210'/>`
            + `<line x1='163' y1='55' x2='163' y2='130'/>`
            + `<line x1='160' y1='130' x2='158' y2='155'/>`
            + `<line x1='158' y1='155' x2='158' y2='210'/>`
            + `<line x1='113' y1='55' x2='113' y2='130'/>`
            + `<line x1='110' y1='130' x2='108' y2='155'/>`
            + `<line x1='108' y1='155' x2='108' y2='210'/>`
            + `<line x1='127' y1='55' x2='127' y2='130'/>`
            + `<line x1='130' y1='130' x2='132' y2='155'/>`
            + `<line x1='132' y1='155' x2='132' y2='210'/>`
            + `</g>`;

        const flySeam = `<g fill='none' stroke='${seam}' opacity='0.55'>`
            + `<line x1='120' y1='55' x2='120' y2='95' stroke-width='1.2'/>`
            + `<line x1='117' y1='55' x2='117' y2='95' stroke-width='0.6' opacity='0.45'/>`
            + `<line x1='123' y1='55' x2='123' y2='95' stroke-width='0.6' opacity='0.45'/>`
            + `</g>`;

        const hemDetails = `<g fill='none' stroke='${seam}' stroke-width='0.65' opacity='0.42'>`
            + `<line x1='79' y1='208' x2='108' y2='208'/>`
            + `<line x1='79' y1='212' x2='108' y2='212'/>`
            + `<line x1='132' y1='208' x2='161' y2='208'/>`
            + `<line x1='132' y1='212' x2='161' y2='212'/>`
            + `</g>`;

        const pockets =
              `<path d='M76 57 Q76 72 90 75 L90 57 Z' fill='none' stroke='${seam}' stroke-width='0.9' opacity='0.55'/>`
            + `<path d='M78 58 Q78 70 90 73' fill='none' stroke='${seam}' stroke-width='0.5' opacity='0.30'/>`
            + `<path d='M130 57 Q164 57 164 72 L164 75 Q145 80 130 75 Z' fill='none' stroke='${seam}' stroke-width='0.9' opacity='0.55'/>`
            + `<path d='M132 59 Q162 59 162 72' fill='none' stroke='${seam}' stroke-width='0.5' opacity='0.30'/>`;

        const beltLoops = `<g fill='none' stroke='${seam}' stroke-width='1.0' opacity='0.45'>`
            + `<rect x='88'  y='39' width='7' height='14' rx='1'/>`
            + `<rect x='108' y='39' width='7' height='14' rx='1'/>`
            + `<rect x='125' y='39' width='7' height='14' rx='1'/>`
            + `<rect x='145' y='39' width='7' height='14' rx='1'/>`
            + `</g>`;

        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<rect width='240' height='240' fill='#ffffff'/>`
            + `<defs>`
            +   `<linearGradient id='v${id}' x1='0' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0'   stop-color='${top}'/>`
            +     `<stop offset='0.5' stop-color='${mid}'/>`
            +     `<stop offset='1'   stop-color='${bot}'/>`
            +   `</linearGradient>`
            +   `<linearGradient id='lLeg${id}' x1='0' y1='0' x2='1' y2='0'>`
            +     `<stop offset='0'    stop-color='${vdark}' stop-opacity='0.38'/>`
            +     `<stop offset='0.20' stop-color='${dark}'  stop-opacity='0.08'/>`
            +     `<stop offset='0.38' stop-color='${color}' stop-opacity='0'/>`
            +   `</linearGradient>`
            +   `<linearGradient id='rLeg${id}' x1='1' y1='0' x2='0' y2='0'>`
            +     `<stop offset='0'    stop-color='${vdark}' stop-opacity='0.38'/>`
            +     `<stop offset='0.20' stop-color='${dark}'  stop-opacity='0.08'/>`
            +     `<stop offset='0.38' stop-color='${color}' stop-opacity='0'/>`
            +   `</linearGradient>`
            +   `<radialGradient id='r${id}' cx='0.5' cy='0.50' r='0.60'>`
            +     `<stop offset='0.30' stop-color='${color}' stop-opacity='0'/>`
            +     `<stop offset='0.72' stop-color='${dark}'  stop-opacity='0.25'/>`
            +     `<stop offset='1'    stop-color='${vdark}' stop-opacity='0.55'/>`
            +   `</radialGradient>`
            +   `<radialGradient id='thighHL${id}' cx='0.5' cy='0.28' r='0.45'>`
            +     `<stop offset='0' stop-color='${hi}'    stop-opacity='0.25'/>`
            +     `<stop offset='1' stop-color='${color}' stop-opacity='0'/>`
            +   `</radialGradient>`
            +   `<radialGradient id='kHL${id}' cx='0.5' cy='0.5' r='0.55'>`
            +     `<stop offset='0' stop-color='${fade}'  stop-opacity='0.30'/>`
            +     `<stop offset='1' stop-color='${color}' stop-opacity='0'/>`
            +   `</radialGradient>`
            +   `<radialGradient id='kSh${id}' cx='0.5' cy='0.5' r='0.5'>`
            +     `<stop offset='0' stop-color='${dark}' stop-opacity='0.50'/>`
            +     `<stop offset='1' stop-color='${dark}' stop-opacity='0'/>`
            +   `</radialGradient>`
            +   `<linearGradient id='hemSh${id}' x1='0' y1='0' x2='0' y2='1'>`
            +     `<stop offset='0.70' stop-color='${color}' stop-opacity='0'/>`
            +     `<stop offset='1'    stop-color='${vdark}' stop-opacity='0.40'/>`
            +   `</linearGradient>`
            +   `<pattern id='denim${id}' x='0' y='0' width='4' height='8' patternUnits='userSpaceOnUse'>`
            +     `<rect width='4' height='8' fill='${color}'/>`
            +     `<line x1='0' y1='0' x2='4' y2='8' stroke='${threadH}' stroke-width='1.1' opacity='0.18'/>`
            +     `<line x1='-2' y1='0' x2='2' y2='8' stroke='${thread}'  stroke-width='0.8' opacity='0.12'/>`
            +     `<line x1='2' y1='0' x2='6' y2='8' stroke='${thread}'  stroke-width='0.8' opacity='0.10'/>`
            +     `<line x1='0' y1='8' x2='4' y2='0' stroke='${threadH}' stroke-width='0.5' opacity='0.06'/>`
            +     `<line x1='0' y1='2' x2='4' y2='2' stroke='${thread}'  stroke-width='0.6' opacity='0.08'/>`
            +     `<line x1='0' y1='5' x2='4' y2='5' stroke='${threadH}' stroke-width='0.5' opacity='0.06'/>`
            +   `</pattern>`
            // Denim filter: low-freq displacement for coarse twill weave +
            // diffuse lighting for cross-dye yarn depth (dark warp/light weft).
            +   `<filter id='fab${id}' x='-2%' y='-2%' width='104%' height='104%' color-interpolation-filters='sRGB'>`
            +     `<feTurbulence type='fractalNoise' baseFrequency='0.50 0.25' numOctaves='3' seed='7' result='noise'/>`
            +     `<feDisplacementMap in='SourceGraphic' in2='noise' scale='3.0' xChannelSelector='R' yChannelSelector='G' result='warped'/>`
            +     `<feDiffuseLighting in='warped' surfaceScale='1.4' diffuseConstant='0.80' lighting-color='white' result='diffuse'>`
            +       `<feDistantLight azimuth='310' elevation='50'/>`
            +     `</feDiffuseLighting>`
            +     `<feComposite in='warped' in2='diffuse' operator='arithmetic' k1='0' k2='0.82' k3='0.28' k4='0'/>`
            +   `</filter>`
            + `</defs>`
            + `<path d='${path}' fill='url(#denim${id})' filter='url(#fab${id})' stroke='${edge}' stroke-width='1.5' stroke-linejoin='round'/>`
            + `<path d='${path}' fill='url(#v${id})' opacity='0.50'/>`
            + `<path d='${path}' fill='url(#lLeg${id})'/>`
            + `<path d='${path}' fill='url(#rLeg${id})'/>`
            + `<path d='${path}' fill='url(#r${id})'/>`
            + `<path d='${path}' fill='url(#thighHL${id})'/>`
            + `<path d='${path}' fill='url(#hemSh${id})'/>`
            + `<rect x='66' y='40' width='108' height='15' rx='4' fill='${waist}' stroke='${edge}' stroke-width='1'/>`
            + `<rect x='66' y='40' width='108' height='8'  rx='4' fill='${_lighten(waist, 0.12)}' opacity='0.50'/>`
            + `<line x1='66' y1='50' x2='174' y2='50' stroke='${seam}' stroke-width='0.8' opacity='0.55'/>`
            + `<line x1='66' y1='53' x2='174' y2='53' stroke='${seam}' stroke-width='0.5' opacity='0.30'/>`
            + beltLoops
            + pockets
            + `<ellipse cx='92'  cy='130' rx='20' ry='12' fill='url(#kHL${id})'/>`
            + `<ellipse cx='148' cy='130' rx='20' ry='12' fill='url(#kHL${id})'/>`
            + `<ellipse cx='92'  cy='122' rx='18' ry='9'  fill='url(#kSh${id})'/>`
            + `<ellipse cx='148' cy='122' rx='18' ry='9'  fill='url(#kSh${id})'/>`
            + whiskerL
            + whiskerR
            + seamLines
            + flySeam
            + legFolds
            + hemDetails
            + `</svg>`;
    }

    function svgToDataUri(svg) {
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    // Shorts thumbnail — same denim texture as pantsSVG, legs cut at y≈145.
    function shortsSVG(color) {
        const id      = 'g' + Math.random().toString(36).slice(2, 8);
        const hi      = _lighten(color, 0.28);
        const top     = _lighten(color, 0.15);
        const mid     = _lighten(color, 0.05);
        const bot     = _darken(color,  0.22);
        const dark    = _darken(color,  0.28);
        const edge    = _darken(color,  0.35);
        const waist   = _darken(color,  0.18);
        const seam    = _darken(color,  0.48);
        const thread  = _darken(color,  0.12);
        const threadH = _lighten(color, 0.18);
        void hi; void bot;

        const path = 'M66 40 L174 40 L174 55 L135 55 L155 145 L130 145 L120 100 L115 145 L85 145 L106 55 L66 55 Z';

        const tw = `<pattern id='tw${id}' width='4' height='8' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>`
            + `<rect width='4' height='8' fill='${color}'/>`
            + `<line x1='2' y1='0' x2='2' y2='8' stroke='${threadH}' stroke-width='0.9' opacity='0.55'/>`
            + `<line x1='1' y1='0' x2='1' y2='8' stroke='${thread}' stroke-width='0.5' opacity='0.45'/>`
            + `<line x1='3' y1='0' x2='3' y2='8' stroke='${thread}' stroke-width='0.5' opacity='0.45'/>`
            + `<line x1='0' y1='2' x2='4' y2='2' stroke='${thread}' stroke-width='0.4' opacity='0.28'/>`
            + `</pattern>`;

        const grads = `<linearGradient id='lg${id}' x1='0' y1='0' x2='0' y2='1'>`
            + `<stop offset='0'   stop-color='${top}'/>`
            + `<stop offset='0.5' stop-color='${mid}'/>`
            + `<stop offset='1'   stop-color='${_darken(color, 0.30)}'/>`
            + `</linearGradient>`
            + `<linearGradient id='lL${id}' x1='0' y1='0' x2='1' y2='0'>`
            + `<stop offset='0'   stop-color='${dark}' stop-opacity='0.60'/>`
            + `<stop offset='0.5' stop-color='${dark}' stop-opacity='0'/>`
            + `</linearGradient>`
            + `<linearGradient id='lR${id}' x1='1' y1='0' x2='0' y2='0'>`
            + `<stop offset='0'   stop-color='${dark}' stop-opacity='0.60'/>`
            + `<stop offset='0.5' stop-color='${dark}' stop-opacity='0'/>`
            + `</linearGradient>`;

        const seamLines = `<line x1='92'  y1='55' x2='82'  y2='145' stroke='${seam}' stroke-width='0.7' opacity='0.50'/>`
            + `<line x1='148' y1='55' x2='153' y2='145' stroke='${seam}' stroke-width='0.7' opacity='0.50'/>`
            + `<line x1='120' y1='100' x2='117' y2='145' stroke='${seam}' stroke-width='0.5' opacity='0.40'/>`
            + `<line x1='120' y1='100' x2='123' y2='145' stroke='${seam}' stroke-width='0.5' opacity='0.40'/>`;

        const cuffHem = `<line x1='85' y1='145' x2='115' y2='145' stroke='${seam}' stroke-width='1.8'/>`
            + `<line x1='130' y1='145' x2='155' y2='145' stroke='${seam}' stroke-width='1.8'/>`
            + `<line x1='86' y1='142' x2='114' y2='142' stroke='${thread}' stroke-width='0.7' opacity='0.55'/>`
            + `<line x1='131' y1='142' x2='154' y2='142' stroke='${thread}' stroke-width='0.7' opacity='0.55'/>`;

        const pockets = `<path d='M77 62 Q86 72 88 84' fill='none' stroke='${seam}' stroke-width='1.2' opacity='0.65'/>`
            + `<path d='M163 62 Q154 72 152 84' fill='none' stroke='${seam}' stroke-width='1.2' opacity='0.65'/>`;

        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<defs>${tw}${grads}`
            + `<filter id='fn${id}'><feTurbulence type='fractalNoise' baseFrequency='0.50 0.25' numOctaves='3' seed='5'/>`
            + `<feDisplacementMap in='SourceGraphic' scale='2.8' xChannelSelector='R' yChannelSelector='G'/></filter>`
            + `</defs>`
            + `<clipPath id='cp${id}'><path d='${path}'/></clipPath>`
            + `<g clip-path='url(#cp${id})'>`
            + `<rect width='240' height='240' fill='url(#tw${id})' filter='url(#fn${id})'/>`
            + `<rect width='240' height='240' fill='url(#lg${id})' opacity='0.50'/>`
            + `<rect width='240' height='240' fill='url(#lL${id})'/>`
            + `<rect width='240' height='240' fill='url(#lR${id})'/>`
            + `</g>`
            + `<path d='${path}' fill='none' stroke='${edge}' stroke-width='1.5'/>`
            + `<rect x='66' y='40' width='108' height='15' rx='2' fill='${waist}' opacity='0.45'/>`
            + `<line x1='66' y1='50' x2='174' y2='50' stroke='${seam}' stroke-width='0.8' opacity='0.55'/>`
            + pockets + seamLines + cuffHem
            + `</svg>`;
    }

    // Beanie hat thumbnail SVG.
    function beaniesSVG(color) {
        const id    = 'g' + Math.random().toString(36).slice(2, 8);
        const dark  = _darken(color,  0.30);
        const light = _lighten(color, 0.25);
        const ribD  = _darken(color,  0.20);

        const ribs = Array.from({length: 9}, (_, i) =>
            `<line x1='${42 + i * 18}' y1='152' x2='${42 + i * 18}' y2='190'`
            + ` stroke='${ribD}' stroke-width='1.2' opacity='0.45'/>`
        ).join('');

        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<defs>`
            + `<linearGradient id='bd${id}' x1='0' y1='0' x2='1' y2='1'>`
            + `<stop offset='0'   stop-color='${light}'/>`
            + `<stop offset='0.6' stop-color='${color}'/>`
            + `<stop offset='1'   stop-color='${dark}'/>`
            + `</linearGradient>`
            + `<linearGradient id='cu${id}' x1='0' y1='0' x2='0' y2='1'>`
            + `<stop offset='0' stop-color='${_darken(color, 0.08)}'/>`
            + `<stop offset='1' stop-color='${_darken(color, 0.32)}'/>`
            + `</linearGradient>`
            + `</defs>`
            + `<path d='M38 158 Q38 58 120 48 Q202 58 202 158 Z'`
            + ` fill='url(#bd${id})' stroke='${dark}' stroke-width='1.5'/>`
            + `<rect x='36' y='150' width='168' height='42' rx='5'`
            + ` fill='url(#cu${id})' stroke='${dark}' stroke-width='1'/>`
            + ribs
            + `<circle cx='120' cy='52' r='17' fill='${light}' stroke='${dark}' stroke-width='0.8'/>`
            + `<circle cx='114' cy='46' r='5' fill='${_lighten(color, 0.45)}' opacity='0.55'/>`
            + `<ellipse cx='80' cy='98' rx='26' ry='32' fill='${light}' opacity='0.20'/>`
            + `</svg>`;
    }

    // Baseball cap thumbnail SVG.
    function capSVG(color) {
        const id    = 'g' + Math.random().toString(36).slice(2, 8);
        const dark  = _darken(color,  0.30);
        const light = _lighten(color, 0.22);

        return `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>`
            + `<defs>`
            + `<linearGradient id='cd${id}' x1='0' y1='0' x2='1' y2='1'>`
            + `<stop offset='0'    stop-color='${light}'/>`
            + `<stop offset='0.55' stop-color='${color}'/>`
            + `<stop offset='1'    stop-color='${dark}'/>`
            + `</linearGradient>`
            + `</defs>`
            + `<path d='M48 158 Q120 148 202 158 Q218 170 196 180 Q120 173 44 180 Q22 170 48 158 Z'`
            + ` fill='${_darken(color, 0.25)}'/>`
            + `<path d='M38 155 Q38 58 120 50 Q202 58 202 155 Z'`
            + ` fill='url(#cd${id})' stroke='${dark}' stroke-width='1.5'/>`
            + `<rect x='36' y='142' width='168' height='20'`
            + ` fill='${_darken(color, 0.12)}' stroke='${dark}' stroke-width='1'/>`
            + `<circle cx='120' cy='56' r='6' fill='${_darken(color, 0.22)}'/>`
            + `<ellipse cx='84' cy='100' rx='28' ry='34' fill='${light}' opacity='0.22'/>`
            + `</svg>`;
    }

    // Hierarchical catalog: Category → Subcategory → Items.
    const GARMENT_CONFIG = [
        {
            id: 'shirts', label: 'חולצות',
            subcategories: [
                { id: 'tanks', label: 'גופיות', items: [
                    { name: 'גופייה שחורה', type: 'shirt', color: '#1a1a22', sleeve: 'sleeveless' },
                    { name: 'גופייה לבנה',  type: 'shirt', color: '#e0d8c8', sleeve: 'sleeveless' },
                    { name: 'גופייה אדומה', type: 'shirt', color: '#8b2020', sleeve: 'sleeveless' },
                ]},
                { id: 'short-sleeve', label: 'חולצות קצרות', items: [
                    { name: 'חולצה נייבי',  type: 'shirt', color: '#27496d', sleeve: 'short' },
                    { name: 'חולצה ירוקה',  type: 'shirt', color: '#2f5233', sleeve: 'short' },
                    { name: 'חולצה שחורה',  type: 'shirt', color: '#1a1a22', sleeve: 'short' },
                ]},
                { id: 'long-sleeve', label: 'חולצות ארוכות', items: [
                    { name: 'חולצה בורדו',  type: 'shirt', color: '#7a2d3b', sleeve: 'long' },
                    { name: 'חולצה אפורה',  type: 'shirt', color: '#3a3a4a', sleeve: 'long' },
                    { name: 'חולצה לבנה',   type: 'shirt', color: '#e0d8c8', sleeve: 'long' },
                ]},
            ],
        },
        {
            id: 'pants', label: 'מכנסיים',
            subcategories: [
                { id: 'long-pants', label: 'מכנסיים ארוכים', items: [
                    { name: "ג'ינס כחול",     type: 'pants', color: '#34495e', pantsLength: 'long' },
                    { name: 'מכנסיים שחורים', type: 'pants', color: '#222a33', pantsLength: 'long' },
                    { name: 'מכנסי חאקי',     type: 'pants', color: '#8b7355', pantsLength: 'long' },
                ]},
                { id: 'shorts', label: 'מכנסיים קצרים', items: [
                    { name: "שורט ג'ינס",     type: 'pants', color: '#4a6b8a', pantsLength: 'short' },
                    { name: 'שורט שחור',      type: 'pants', color: '#1a1a22', pantsLength: 'short' },
                    { name: 'שורט חאקי',      type: 'pants', color: '#7a6548', pantsLength: 'short' },
                ]},
            ],
        },
        {
            id: 'hats', label: 'כובעים',
            subcategories: [
                { id: 'beanie', label: 'כובע גרב', items: [
                    { name: 'כובע גרב שחור', type: 'hat', color: '#1a1a22', hatStyle: 'beanie' },
                    { name: 'כובע גרב אפור', type: 'hat', color: '#555566', hatStyle: 'beanie' },
                    { name: 'כובע גרב אדום', type: 'hat', color: '#8b2020', hatStyle: 'beanie' },
                ]},
                { id: 'cap', label: 'כובע מצחיה', items: [
                    { name: 'כובע שחור',     type: 'hat', color: '#1a1a22', hatStyle: 'cap' },
                    { name: 'כובע נייבי',    type: 'hat', color: '#27496d', hatStyle: 'cap' },
                    { name: 'כובע ירוק',     type: 'hat', color: '#2f5233', hatStyle: 'cap' },
                ]},
            ],
        },
    ];

    // Flat list of every catalog item — used by the cross-category
    // "Complete the Look" recommender (renderCompleteTheLook).
    const GARMENT_CATALOG = GARMENT_CONFIG.flatMap(
        c => c.subcategories.flatMap(s => s.items)
    );

    // Active shirt's sleeve type — drives sleeve mesh quads in onResults().
    let currentShirtSleeve = 'short';
    // Active pants fit — drives leg-width scaling and inner-gap clamp.
    // FIX 1 — All three values lifted substantially. The old 0.92/1.00/1.14 band
    // pushed the outer leg edge no further out than the hip landmark, which made
    // the pants look like leggings on a normal frame. The new values give pants
    // the visible coverage of real garments (regular ≈ +25% beyond the hip line).
    let currentPantsFit    = 'regular';
    let currentPantsLength = 'long';  // 'long' | 'short'
    let currentHat         = null;    // currently selected hat item, or null
    let _activeCatId       = 'shirts'; // which catalog tab is active
    const PANTS_FIT_SCALE = { slim: 1.25, regular: 1.45, wide: 1.70 };
    // Cache last stable knee positions so a brief landmark loss doesn't collapse legs.
    const _pantsCache = { lKnee: null, rKnee: null };

    // ── Ambient lighting sampler ──────────────────────────────────────────────
    // Samples the canvas torso region every 10 frames (~3 Hz at 30 fps) and
    // computes average luminance + warmth from the background behind the user.
    // Results are applied as ctx.filter before each garment draw so clothes
    // respond to dark rooms, warm tungsten light, cool daylight, etc.
    const _ambientLight = { brightness: 100, contrast: 100, sepia: 0, _tick: 0 };

    function _sampleLighting(cx, cy, halfW, halfH) {
        if (++_ambientLight._tick % 10 !== 0) return;   // rate-limit to ~3 Hz
        const W = canvasElement.width, H = canvasElement.height;
        const x = Math.max(0, Math.floor(cx - halfW));
        const y = Math.max(0, Math.floor(cy - halfH));
        const w = Math.min(W - x, Math.ceil(halfW * 2));
        const h = Math.min(H - y, Math.ceil(halfH * 2));
        if (w < 2 || h < 2) return;
        try {
            const d = ctx.getImageData(x, y, w, h).data;
            let r = 0, g = 0, b = 0, n = 0;
            // Sample every 4th pixel (stride 16) — cheap, representative
            for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
            if (!n) return;
            r /= n; g /= n; b /= n;
            const lum = 0.299*r + 0.587*g + 0.114*b;
            // Brightness: dark room (lum≈0) → 80%, bright room (lum≈255) → 118%
            const targetBri = 80 + (lum / 255) * 38;
            // Contrast: low light → slightly softer, high light → slightly crisper
            const targetCon = 92 + (lum / 255) * 16;
            // Warm bias: warm ambient (red > blue) → subtle sepia shift, max 10%
            const targetSep = Math.max(0, Math.min(10, ((r - b) / 255) * 16));
            // EMA — smooth to avoid jarring per-frame jumps
            const a = 0.14;
            _ambientLight.brightness += a * (targetBri - _ambientLight.brightness);
            _ambientLight.contrast   += a * (targetCon - _ambientLight.contrast);
            _ambientLight.sepia      += a * (targetSep - _ambientLight.sepia);
        } catch (_) { /* cross-origin / security guard */ }
    }

    function sortCatalogBySubtype(picked) { renderCatalog(picked); }

    function renderCatalog(selected) {
        const container = document.getElementById('catalog-grid-container');
        if (!container) return;
        container.innerHTML = '';

        // Tab bar
        const tabs = document.createElement('div');
        tabs.className = 'cat-tabs';
        GARMENT_CONFIG.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = 'cat-tab' + (cat.id === _activeCatId ? ' active' : '');
            btn.textContent = cat.label;
            btn.addEventListener('click', () => { _activeCatId = cat.id; renderCatalog(null); });
            tabs.appendChild(btn);
        });
        container.appendChild(tabs);

        // Active category panel
        const cat = GARMENT_CONFIG.find(c => c.id === _activeCatId);
        if (!cat) return;

        cat.subcategories.forEach(sub => {
            const section = document.createElement('div');
            section.className = 'cat-section';
            const lbl = document.createElement('div');
            lbl.className = 'cat-section-label';
            lbl.textContent = sub.label;
            section.appendChild(lbl);
            const grid = document.createElement('div');
            grid.className = 'catalog-grid';

            sub.items.forEach(item => {
                const card = document.createElement('div');
                card.className = 'catalog-card';
                card.dataset.type = item.type;
                if (selected && item === selected) card.classList.add('selected');

                const img = document.createElement('img');
                if (item.src) {
                    img.src = item.src;
                    img.crossOrigin = 'anonymous';
                } else {
                    let svg;
                    if      (item.type === 'shirt')              svg = shirtSVG(item.color, item.sleeve);
                    else if (item.pantsLength === 'short')        svg = shortsSVG(item.color);
                    else if (item.type === 'pants')               svg = pantsSVG(item.color);
                    else if (item.hatStyle === 'beanie')          svg = beaniesSVG(item.color);
                    else                                          svg = capSVG(item.color);
                    img.src = svgToDataUri(svg);
                }
                img.alt = item.name;
                const span = document.createElement('span');
                span.textContent = item.name;
                card.appendChild(img);
                card.appendChild(span);

                card.addEventListener('click', () => {
                    container.querySelectorAll(`.catalog-card[data-type="${item.type}"]`)
                        .forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');

                    if (item.type === 'hat') {
                        currentHat = item;
                        placeholder.innerText = 'כובע נבחר — לחץ על כפתור המצלמה';
                        return;
                    }

                    if (item.src) {
                        loadGarmentFromSrc(item.src, item.type);
                    } else {
                        const svg = item.type === 'shirt'
                            ? shirtSVG(item.color, item.sleeve)
                            : (item.pantsLength === 'short' ? shortsSVG(item.color) : pantsSVG(item.color));
                        loadGarmentFromSrc(svgToDataUri(svg), item.type);
                    }

                    if (item.type === 'shirt') {
                        currentShirtSleeve = item.sleeve || 'short';
                    } else {
                        currentPantsFit    = item.fit         || 'regular';
                        currentPantsLength = item.pantsLength || 'long';
                    }
                    placeholder.innerText = 'בגד נבחר — לחץ על כפתור המצלמה';
                });

                grid.appendChild(card);
            });

            section.appendChild(grid);
            container.appendChild(section);
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
        // Expand each vertex 1.5 px outward from the triangle centroid.
        // Adjacent triangles share an edge; without overdraw the browser's
        // rasterizer can leave a 1-px transparent crack at that boundary due
        // to floating-point rounding. The expansion fills it without visibly
        // stretching the texture (1.5 px is sub-perceptible at 640×480).
        const EXPAND = 1.5;
        const cx = (dst[0][0] + dst[1][0] + dst[2][0]) / 3;
        const cy = (dst[0][1] + dst[1][1] + dst[2][1]) / 3;
        for (let i = 0; i < 3; i++) {
            const dx = dst[i][0] - cx, dy = dst[i][1] - cy;
            const len = Math.hypot(dx, dy) || 1;
            const px = dst[i][0] + (dx / len) * EXPAND;
            const py = dst[i][1] + (dy / len) * EXPAND;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
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

    // Single quad (4 pts → 2 triangles). Used for per-segment pants warp
    // (upper hip→knee and lower knee→ankle on each leg).
    function drawQuad(img, s0, s1, s2, s3, d0, d1, d2, d3) {
        // ── Contact shadow pass ───────────────────────────────────────────
        // Blurred multiply polygon at the destination quad corners — drawn
        // BEFORE the texture so the shadow falls on the body surface beneath
        // the pants. Blur extends beyond the hard pant edge, creating a
        // penumbra that makes each leg segment look grounded on the body.
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.filter = 'blur(7px)';
        ctx.globalAlpha = 0.48;
        ctx.fillStyle = 'rgba(55,55,55,1)';
        ctx.beginPath();
        ctx.moveTo(d0[0], d0[1]);
        ctx.lineTo(d1[0], d1[1]);
        ctx.lineTo(d3[0], d3[1]);
        ctx.lineTo(d2[0], d2[1]);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // ── Texture warp ──────────────────────────────────────────────────
        drawWarpedTri(img, [s0, s1, s2], [d0, d1, d2]);
        drawWarpedTri(img, [s1, s3, s2], [d1, d3, d2]);
    }

    // Build the 4 dst corners of one leg segment by extruding the segment's
    // top→bottom direction vector perpendicularly. Same principle as the
    // sleeve warp: each section follows its own local axis so bending the
    // knee rotates the calf without dragging the thigh.
    // side='L' pushes outer to the geometric left of the bone, 'R' to the right.
    function buildLegSegment(topPt, botPt, topWidth, botWidth, gap, side) {
        const dx = botPt.x - topPt.x;
        const dy = botPt.y - topPt.y;
        const len = Math.hypot(dx, dy) || 1;
        const sign = (side === 'L') ? 1 : -1;
        const px = sign * (-dy / len);
        const py = sign * ( dx / len);
        return {
            outerTop: [topPt.x + px * topWidth, topPt.y + py * topWidth],
            innerTop: [topPt.x - px * gap,      topPt.y - py * gap],
            outerBot: [botPt.x + px * botWidth, botPt.y + py * botWidth],
            innerBot: [botPt.x - px * gap,      botPt.y - py * gap],
        };
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
    function drawSleeveQuad(side, type, imgW, imgH, shoulder, elbow, shoulderWidth, elbowVis, wrist) {
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
            const minLen = shoulderWidth * 0.55;
            const maxLen = shoulderWidth * 1.80;
            const clampedLen = Math.max(minLen, Math.min(maxLen, rawLen));
            let cdx = rawDx / rawLen * clampedLen;
            let cdy = rawDy / rawLen * clampedLen;
            if (cached) {
                const a = 0.40;
                cdx = a * cdx + (1 - a) * cached.dx;
                cdy = a * cdy + (1 - a) * cached.dy;
            }
            dx = cdx; dy = cdy;
            _sleeveCache[side] = { dx, dy };
        }

        const dlen = Math.hypot(dx, dy) || 1;
        const sign = (side === 'L') ? 1 : -1;
        let px =  dy / dlen * sign;
        let py = -dx / dlen * sign;
        // Gravity bias — biases the perpendicular push downward so sleeves hang
        // naturally instead of jutting straight out from the shoulder.
        // Short: reduced gravity bias (0.14 vs 0.25) — less downward pull on the
        // outer edge so the hem drapes horizontally across the arm rather than
        // hanging into a spike below it.
        py = py + (type === 'long' ? 0.25 : 0.14);
        const pLen = Math.hypot(px, py);
        px = px/pLen; py = py/pLen;

        // Sleeve end parameter along shoulder→elbow.
        // Short: 0.62 keeps the cap well above the elbow — no pointy over-extension.
        const tEnd = (type === 'long') ? 1.30 : 0.62;
        // Arm thickness estimate from shoulder→elbow distance, clamped to [0.7, 1.2].
        const armLen = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
        const armScale = Math.min(1.2, Math.max(0.7, armLen / (shoulderWidth * 1.2)));
        // Short-sleeve: narrower cap (0.46) and much narrower cuff (0.30) so the
        // sleeve tapers naturally and the hem ring is no wider than the arm itself.
        const wCap  = shoulderWidth * (type === 'long' ? 0.50 : 0.46) * armScale;
        const wCuff = shoulderWidth * (type === 'long' ? 0.38 : 0.30) * armScale;

        // Ring layout:
        //   short: 8 rings (i=0..7), 7 quads — denser bend tracking
        //   long : 10 rings (i=0..7 main bicep mesh, i=8..9 forearm extension)
        // Short: 6 rings (5 quads = 10 triangles) — fewer segments reduce the
        // chance of a spike at the outer tip; geometry stays smooth at 30 fps.
        const ringCount     = (type === 'long') ? 10 : 6;
        const mainRingCount = (type === 'long') ?  8 : 6;

        const rings = [];
        for (let i = 0; i < ringCount; i++) {
            let cxR, cyR, w;
            if (type === 'long' && i >= mainRingCount) {
                // Forearm rings: ring 8 at wrist landmark (or extrapolation),
                // ring 9 at wrist + (dx,dy) * 0.15 (halfway between wrist and wrist+dir*0.3).
                const wristVisible = wrist && wrist.v > 0.5;
                const wristPos = wristVisible
                    ? { x: wrist.x, y: wrist.y }
                    : { x: shoulder.x + dx * tEnd, y: shoulder.y + dy * tEnd };
                const forearmF = i - mainRingCount;   // 0 for ring 8, 1 for ring 9
                cxR = wristPos.x + dx * 0.15 * forearmF;
                cyR = wristPos.y + dy * 0.15 * forearmF;
                w = wCuff;
            } else {
                // Main rings 0..7 along shoulder→elbow direction.
                const f = i / (mainRingCount - 1);
                const t = tEnd * f;
                cxR = shoulder.x + dx * t;
                cyR = shoulder.y + dy * t;
                w = wCap + (wCuff - wCap) * f;
            }
            // Short: symmetric 0.52/0.48 split keeps the sleeve centred on the arm
            // axis; the old 0.55/0.45 body-side bias was making the outer edge spike.
            const iF = type === 'long' ? 0.55 : 0.52;
            const oF = type === 'long' ? 0.45 : 0.48;
            const inner = [cxR - px * w * iF, cyR - py * w * iF];
            const outer = [cxR + px * w * oF, cyR + py * w * oF];
            rings.push({ inner, outer });
        }

        // Source rings — sample the sleeve quadrilateral in the flat-lay SVG.
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
        // Source linearly sampled across all rings — cuff source naturally lands
        // on rings 8-9 for long sleeve so the forearm continues the texture.
        const srcRings = [];
        const srcDenom = ringCount - 1;
        for (let i = 0; i < ringCount; i++) {
            const f = i / srcDenom;
            const inner = [sIT[0] + (sIE[0] - sIT[0]) * f, sIT[1] + (sIE[1] - sIT[1]) * f];
            const outer = [sOT[0] + (sOE[0] - sOT[0]) * f, sOT[1] + (sOE[1] - sOT[1]) * f];
            srcRings.push({ inner, outer });
        }

        const quadCount = ringCount - 1;
        for (let i = 0; i < quadCount; i++) {
            const a = srcRings[i],   b = srcRings[i + 1];
            const A = rings[i],      B = rings[i + 1];
            drawWarpedTri(shirtOffscreen,
                [a.inner, a.outer, b.inner],
                [A.inner, A.outer, B.inner]);
            drawWarpedTri(shirtOffscreen,
                [a.outer, b.outer, b.inner],
                [A.outer, B.outer, B.inner]);
        }

        return rings;
    }

    // === Hat rendering helpers — draw directly onto ctx in translated/rotated space ===
    // Origin (0,0) = hat bottom. Hat grows upward (negative y). Width spans ±width/2.
    function _drawBeanie(c, width, color) {
        const cuffH = width * 0.22;
        const domeH = width * 0.62;
        const pomR  = width * 0.11;
        const dark   = _darken(color,  0.30);
        const light  = _lighten(color, 0.24);
        const ribD   = _darken(color,  0.18);

        // dome
        const dGrad = c.createLinearGradient(-width * 0.35, -cuffH - domeH, width * 0.35, -cuffH);
        dGrad.addColorStop(0, light);
        dGrad.addColorStop(0.6, color);
        dGrad.addColorStop(1, dark);
        c.fillStyle = dGrad;
        c.beginPath();
        c.moveTo(-width / 2, -cuffH);
        c.bezierCurveTo(-width / 2, -cuffH - domeH * 1.35, width / 2, -cuffH - domeH * 1.35, width / 2, -cuffH);
        c.fill();
        c.strokeStyle = dark; c.lineWidth = 1.5;
        c.stroke();

        // cuff
        const cGrad = c.createLinearGradient(0, -cuffH, 0, 0);
        cGrad.addColorStop(0, _darken(color, 0.08));
        cGrad.addColorStop(1, _darken(color, 0.32));
        c.fillStyle = cGrad;
        c.beginPath(); c.rect(-width / 2, -cuffH, width, cuffH); c.fill();
        c.strokeStyle = dark; c.lineWidth = 1; c.stroke();

        // rib lines
        c.strokeStyle = ribD; c.lineWidth = 1;
        for (let i = 1; i < 9; i++) {
            const x = -width / 2 + (i / 9) * width;
            c.globalAlpha = 0.40;
            c.beginPath(); c.moveTo(x, -cuffH + 2); c.lineTo(x, -2); c.stroke();
        }
        c.globalAlpha = 1;

        // cuff fold line
        c.strokeStyle = dark; c.lineWidth = 1.5; c.globalAlpha = 0.55;
        c.beginPath(); c.moveTo(-width / 2 + 3, -cuffH); c.lineTo(width / 2 - 3, -cuffH); c.stroke();
        c.globalAlpha = 1;

        // pom-pom
        const pomY = -cuffH - domeH * 1.02;
        const pGrad = c.createRadialGradient(-pomR * 0.3, pomY - pomR * 0.3, pomR * 0.05, 0, pomY, pomR);
        pGrad.addColorStop(0, _lighten(color, 0.48));
        pGrad.addColorStop(1, light);
        c.beginPath(); c.arc(0, pomY, pomR, 0, Math.PI * 2);
        c.fillStyle = pGrad; c.fill();
        c.strokeStyle = dark; c.lineWidth = 0.8; c.stroke();

        // dome highlight
        c.beginPath();
        c.ellipse(-width * 0.18, -cuffH - domeH * 0.62, width * 0.13, domeH * 0.20, -0.3, 0, Math.PI * 2);
        c.fillStyle = light; c.globalAlpha = 0.30; c.fill(); c.globalAlpha = 1;
    }

    function _drawCap(c, width, color, facing) {
        // facing: 1 = brim extends right, -1 = brim extends left
        const bandH  = width * 0.17;
        const domeH  = width * 0.50;
        const brimW  = width * 0.62;
        const brimH  = width * 0.09;
        const dark   = _darken(color,  0.30);
        const light  = _lighten(color, 0.22);
        const brimCX = facing * width * 0.20;
        const brimCY = -bandH * 0.5;

        // brim (drawn before dome so dome covers the inner edge)
        const bGrad = c.createLinearGradient(0, brimCY - brimH, 0, brimCY + brimH * 1.4);
        bGrad.addColorStop(0, _darken(color, 0.14));
        bGrad.addColorStop(1, _darken(color, 0.44));
        c.fillStyle = bGrad;
        c.beginPath(); c.ellipse(brimCX, brimCY, brimW / 2, brimH, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = dark; c.lineWidth = 0.8; c.stroke();

        // dome
        const dGrad = c.createLinearGradient(-width * 0.3, -bandH - domeH, width * 0.3, -bandH);
        dGrad.addColorStop(0, light);
        dGrad.addColorStop(0.5, color);
        dGrad.addColorStop(1, dark);
        c.fillStyle = dGrad;
        c.beginPath();
        c.moveTo(-width / 2, -bandH);
        c.bezierCurveTo(-width / 2, -bandH - domeH * 1.5, width / 2, -bandH - domeH * 1.5, width / 2, -bandH);
        c.closePath(); c.fill();
        c.strokeStyle = dark; c.lineWidth = 1.5; c.stroke();

        // sweatband
        const sGrad = c.createLinearGradient(0, -bandH, 0, 0);
        sGrad.addColorStop(0, _darken(color, 0.10));
        sGrad.addColorStop(1, _darken(color, 0.30));
        c.fillStyle = sGrad; c.fillRect(-width / 2, -bandH, width, bandH);
        c.strokeStyle = dark; c.lineWidth = 1.5; c.globalAlpha = 0.58;
        c.beginPath(); c.moveTo(-width / 2 + 2, -bandH); c.lineTo(width / 2 - 2, -bandH); c.stroke();
        c.globalAlpha = 1;

        // button on top
        c.beginPath(); c.arc(0, -bandH - domeH, width * 0.033, 0, Math.PI * 2);
        c.fillStyle = _darken(color, 0.22); c.fill();

        // dome highlight
        c.beginPath();
        c.ellipse(-width * 0.16, -bandH - domeH * 0.60, width * 0.12, domeH * 0.19, -0.4, 0, Math.PI * 2);
        c.fillStyle = light; c.globalAlpha = 0.28; c.fill(); c.globalAlpha = 1;
    }

    // === Shirt depth shadows — drawn under the garment before mesh warp ===
    function drawArmpitShadow(lApt, rApt, sw) {
        // Estimate shirt extents from landmark geometry
        const cx   = (lApt.x + rApt.x) / 2;
        const topY = Math.min(lApt.y, rApt.y) - sw * 0.38;
        const hemY = Math.max(lApt.y, rApt.y) + sw * 0.82;

        ctx.save();
        ctx.globalCompositeOperation = 'multiply';

        // ── Original armpit hollow shadows (fabric tucking into armpit) ──
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        [lApt, rApt].forEach(apt => {
            ctx.beginPath();
            ctx.ellipse(apt.x, apt.y, sw * 0.12, sw * 0.26, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // ── Left shirt-edge body shadow ───────────────────────────────────
        // Soft blurred strip — the shirt edge rests on the body and casts
        // a curved shadow on the flank skin visible beside the garment.
        ctx.save();
        ctx.filter = 'blur(9px)';
        ctx.globalAlpha = 0.42;
        const lEdge = ctx.createLinearGradient(lApt.x - sw * 0.28, 0, lApt.x + sw * 0.06, 0);
        lEdge.addColorStop(0, 'rgba(50,50,50,1)');
        lEdge.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lEdge;
        ctx.fillRect(lApt.x - sw * 0.28, topY, sw * 0.34, hemY - topY);
        ctx.restore();

        // ── Right shirt-edge body shadow ──────────────────────────────────
        ctx.save();
        ctx.filter = 'blur(9px)';
        ctx.globalAlpha = 0.42;
        const rEdge = ctx.createLinearGradient(rApt.x + sw * 0.28, 0, rApt.x - sw * 0.06, 0);
        rEdge.addColorStop(0, 'rgba(50,50,50,1)');
        rEdge.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rEdge;
        ctx.fillRect(rApt.x - sw * 0.06, topY, sw * 0.34, hemY - topY);
        ctx.restore();

        // ── Shirt hem contact shadow ──────────────────────────────────────
        // Blurred horizontal strip just below hem — the bottom edge of the
        // fabric is closest to the body surface and casts a harder shadow.
        ctx.save();
        ctx.filter = 'blur(11px)';
        ctx.globalAlpha = 0.40;
        const hemGrad = ctx.createLinearGradient(0, hemY, 0, hemY + sw * 0.11);
        hemGrad.addColorStop(0, 'rgba(40,40,40,1)');
        hemGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hemGrad;
        ctx.fillRect(cx - sw * 0.60, hemY - sw * 0.02, sw * 1.20, sw * 0.13);
        ctx.restore();

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

        if (!shirtLoaded && !pantsLoaded && !currentHat) return;

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

        // Sample torso region for ambient lighting (runs ~3 Hz — every 10 frames).
        // Must happen AFTER the video frame is drawn onto the canvas.
        _sampleLighting(sCenter.x, sCenter.y, shoulderWidth * 0.55, shoulderWidth * 0.75);
        const _litFilter = `brightness(${_ambientLight.brightness.toFixed(0)}%) contrast(${_ambientLight.contrast.toFixed(0)}%) sepia(${_ambientLight.sepia.toFixed(0)}%)`;

        let shirtBottomY = hCenter.y;

        // ── SHIRT ────────────────────────────────────────────────────────────
        if (shirtLoaded && torsoVis) {
            ctx.filter = _litFilter;
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
            const neckPt = along(sCenter, -0.28);
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
            let rings_L = null, rings_R = null;
            if (!isSideways && currentShirtSleeve !== 'sleeveless') {
                const lEv = raw(13).v, rEv = raw(14).v;
                rings_L = drawSleeveQuad('L', currentShirtSleeve, imgW, imgH, lShoulder, lElbow, shoulderWidth, lEv, raw(15));
                rings_R = drawSleeveQuad('R', currentShirtSleeve, imgW, imgH, rShoulder, rElbow, shoulderWidth, rEv, raw(16));
            }

            drawMeshWarped(shirtOffscreen, src, dst);

            // Sleeve→torso connector quad — fills the seam gap between the shirt
            // body edge and the sleeve cap.
            function fillSleeveJoin(shirtRingInner, shirtRingOuter, dstShoulderTop, dstArmpitSide) {
                ctx.save();
                const px = shirtOffscreen.getContext('2d').getImageData(120,80,1,1).data;
                ctx.fillStyle = `rgba(${px[0]},${px[1]},${px[2]},1.0)`;
                ctx.beginPath();
                ctx.moveTo(dstShoulderTop[0], dstShoulderTop[1]);
                ctx.lineTo(dstArmpitSide[0],  dstArmpitSide[1]);
                ctx.lineTo(shirtRingInner[0], shirtRingInner[1]);
                ctx.lineTo(shirtRingOuter[0], shirtRingOuter[1]);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }
            if (rings_L && rings_R) {
                fillSleeveJoin(rings_L[0].inner, rings_L[0].outer, dst[0], dst[3]);
                fillSleeveJoin(rings_R[0].inner, rings_R[0].outer, dst[2], dst[5]);
            }

            shirtBottomY = (dst[6][1] + dst[7][1] + dst[8][1]) / 3;
            ctx.filter = 'none';
        }

        // ── PANTS ────────────────────────────────────────────────────────────
        if (pantsLoaded && hipVis) {
            ctx.filter = _litFilter;
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

            const hipSpan = Math.abs(lHip.x - rHip.x) || 1;
            const baseGap = Math.max(8, hipSpan * 0.08);
            const fitBias = (currentPantsFit === 'slim' ? 0.85
                          : currentPantsFit === 'wide' ? 1.35 : 1.00);
            const gapHip  = baseGap * fitBias;
            const gapKnee = gapHip  * 1.00;
            const gapAnk  = gapHip  * 0.95;

            // Six independent segments: { thigh, knee, calf } × { left, right }.
            // Each leg's outer span tracks its own landmark independently, then
            // is capped against shoulderWidth so a sideways-moving leg can't
            // make the pant width explode. Adjacent segments share edge coords
            // so seams stay closed.
            const maxSpan    = shoulderWidth * 0.9;
            const lHipSpan   = Math.min(maxSpan,        Math.abs(lHip.x    - cx) * pScale * 1.10);
            const rHipSpan   = Math.min(maxSpan,        Math.abs(rHip.x    - cx) * pScale * 1.10);
            const lKneeSpan  = Math.min(maxSpan * 0.88, Math.abs(lKneePt.x - cx) * pScale * 1.00);
            const rKneeSpan  = Math.min(maxSpan * 0.88, Math.abs(rKneePt.x - cx) * pScale * 1.00);
            const lAnkleSpan = Math.min(maxSpan * 0.78, Math.abs(lBot.x    - cx) * pScale * 0.90);
            const rAnkleSpan = Math.min(maxSpan * 0.78, Math.abs(rBot.x    - cx) * pScale * 0.90);

            const lMidThigh = { x: (lHip.x    + lKneePt.x) / 2, y: (lHip.y    + lKneePt.y) / 2 };
            const rMidThigh = { x: (rHip.x    + rKneePt.x) / 2, y: (rHip.y    + rKneePt.y) / 2 };
            const lMidCalf  = { x: (lKneePt.x + lBot.x   ) / 2, y: (lKneePt.y + lBot.y   ) / 2 };
            const rMidCalf  = { x: (rKneePt.x + rBot.x   ) / 2, y: (rKneePt.y + rBot.y   ) / 2 };
            void lMidCalf; void rMidCalf;

            // Waistband strip — spans from left outer to right outer plus gap.
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.20)';
            const waistW = lHipSpan + rHipSpan + gapHip * 2;
            ctx.fillRect(cx - waistW/2, pantsTopY - 6, waistW, 10);
            ctx.restore();

            // Source bands on the 240x240 pants SVG.
            const thighTopY = 0.17 * imgH;
            const thighBotY = 0.42 * imgH;   // = knee top
            const kneeBotY  = 0.58 * imgH;   // = calf top
            const calfBotY  = 0.90 * imgH;

            if (currentPantsLength === 'short') {
                // SHORTS — single hip-to-knee segment per leg.
                // Source UV spans the upper 60% of the shorts SVG (waist → cuff).
                const sBotY = 0.60 * imgH;

                // LEFT LEG (hip → knee, single segment)
                {
                    const seg = buildLegSegment(lHip, lKneePt, lHipSpan, lKneeSpan * 1.05, gapHip, 'L');
                    drawQuad(pantsOffscreen,
                        [0.27*imgW, thighTopY], [0.46*imgW, thighTopY],
                        [0.27*imgW, sBotY],     [0.46*imgW, sBotY],
                        seg.outerTop, seg.innerTop,
                        seg.outerBot, seg.innerBot);
                }

                // RIGHT LEG (hip → knee, single segment)
                {
                    const seg = buildLegSegment(rHip, rKneePt, rHipSpan, rKneeSpan * 1.05, gapHip, 'R');
                    drawQuad(pantsOffscreen,
                        [0.54*imgW, thighTopY], [0.73*imgW, thighTopY],
                        [0.54*imgW, sBotY],     [0.73*imgW, sBotY],
                        seg.innerTop, seg.outerTop,
                        seg.innerBot, seg.outerBot);
                }
            } else {
                // FULL PANTS — 3 segments per leg (thigh / knee / calf).

                // LEFT THIGH (hip → midThigh) — segment direction follows lHip→lMidThigh.
                {
                    const seg = buildLegSegment(lHip, lMidThigh, lHipSpan, lHipSpan * 0.94, gapHip, 'L');
                    drawQuad(pantsOffscreen,
                        [0.28*imgW, thighTopY], [0.46*imgW, thighTopY],
                        [0.28*imgW, thighBotY], [0.46*imgW, thighBotY],
                        seg.outerTop, seg.innerTop,
                        seg.outerBot, seg.innerBot);
                }

                // LEFT KNEE (midThigh → knee) — independent direction lMidThigh→lKneePt.
                {
                    const seg = buildLegSegment(lMidThigh, lKneePt, lHipSpan * 0.94, lKneeSpan, gapKnee, 'L');
                    drawQuad(pantsOffscreen,
                        [0.29*imgW, thighBotY], [0.45*imgW, thighBotY],
                        [0.29*imgW, kneeBotY],  [0.45*imgW, kneeBotY],
                        seg.outerTop, seg.innerTop,
                        seg.outerBot, seg.innerBot);
                }

                // LEFT CALF (knee → ankle) — independent direction lKneePt→lBot.
                {
                    const seg = buildLegSegment(lKneePt, lBot, lKneeSpan, lAnkleSpan, gapAnk, 'L');
                    drawQuad(pantsOffscreen,
                        [0.30*imgW, kneeBotY], [0.44*imgW, kneeBotY],
                        [0.30*imgW, calfBotY], [0.44*imgW, calfBotY],
                        seg.outerTop, seg.innerTop,
                        seg.outerBot, seg.innerBot);
                }

                // RIGHT THIGH (hip → midThigh). SVG right-leg src goes inner→outer.
                {
                    const seg = buildLegSegment(rHip, rMidThigh, rHipSpan, rHipSpan * 0.94, gapHip, 'R');
                    drawQuad(pantsOffscreen,
                        [0.54*imgW, thighTopY], [0.72*imgW, thighTopY],
                        [0.54*imgW, thighBotY], [0.72*imgW, thighBotY],
                        seg.innerTop, seg.outerTop,
                        seg.innerBot, seg.outerBot);
                }

                // RIGHT KNEE (midThigh → knee).
                {
                    const seg = buildLegSegment(rMidThigh, rKneePt, rHipSpan * 0.94, rKneeSpan, gapKnee, 'R');
                    drawQuad(pantsOffscreen,
                        [0.55*imgW, thighBotY], [0.71*imgW, thighBotY],
                        [0.55*imgW, kneeBotY],  [0.71*imgW, kneeBotY],
                        seg.innerTop, seg.outerTop,
                        seg.innerBot, seg.outerBot);
                }

                // RIGHT CALF (knee → ankle).
                {
                    const seg = buildLegSegment(rKneePt, rBot, rKneeSpan, rAnkleSpan, gapAnk, 'R');
                    drawQuad(pantsOffscreen,
                        [0.56*imgW, kneeBotY], [0.70*imgW, kneeBotY],
                        [0.56*imgW, calfBotY], [0.70*imgW, calfBotY],
                        seg.innerTop, seg.outerTop,
                        seg.innerBot, seg.outerBot);
                }
            }
            ctx.filter = 'none';
        }

        // ── HAT ──────────────────────────────────────────────────────────────
        if (currentHat) {
            const lEarR = raw(7), rEarR = raw(8), noseR = raw(0);
            if (lEarR.v > 0.20 || rEarR.v > 0.20) {
                const lE = applySmooth('hLE', lEarR, 0.40);
                const rE = applySmooth('hRE', rEarR, 0.40);
                const ns = applySmooth('hNs', noseR, 0.40);

                const earDist = Math.hypot(rE.x - lE.x, rE.y - lE.y);
                if (earDist > 8) {
                    const headCX    = (lE.x + rE.x) / 2;
                    const headCY    = (lE.y + rE.y) / 2;
                    const tilt      = Math.atan2(rE.y - lE.y, rE.x - lE.x);
                    const hatW      = earDist * 1.90;
                    const hatBotY   = headCY - earDist * 0.12;
                    const facingDir = (ns.x - headCX) > 0 ? 1 : -1;

                    ctx.save();
                    ctx.translate(headCX, hatBotY);
                    ctx.rotate(tilt);
                    ctx.filter = _litFilter;
                    if (currentHat.hatStyle === 'beanie') {
                        _drawBeanie(ctx, hatW, currentHat.color);
                    } else {
                        _drawCap(ctx, hatW, currentHat.color, facingDir);
                    }
                    ctx.restore();
                }
            }
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

    /**
     * =======================================================
     * FOCUSED TRY-ON MODE — triggered by the store handoff.
     * URL: ?itemType=shirt|pants&subType=...&color=RRGGBB
     * → isolate that one garment, skip the catalog, show a
     *   status bar + a cross-category "Complete the Look" slider.
     * =======================================================
     */
    // Store vocab → pear-demo vocab (shared by the URL handoff + live swaps).
    const SLEEVE_MAP = { short_sleeve: 'short', long_sleeve: 'long', sleeveless: 'sleeveless', short: 'short', long: 'long' };

    // Load + activate a garment in the camera engine from raw handoff fields.
    function applyHandoffGarment(itemType, subType, color) {
        if (color && color.charAt(0) !== '#') color = '#' + color;
        if (itemType === 'shirt') {
            currentShirtSleeve = SLEEVE_MAP[subType] || 'short';
            loadGarmentFromSrc(svgToDataUri(shirtSVG(color, currentShirtSleeve)), 'shirt');
        } else if (itemType === 'pants') {
            currentPantsFit = (['slim', 'regular', 'wide'].indexOf(subType) !== -1) ? subType : 'regular';
            loadGarmentFromSrc(svgToDataUri(pantsSVG(color)), 'pants');
        }
    }

    // Cross-category recommendations from GARMENT_CATALOG.
    // Shirt handoff → suggest PANTS; pants handoff → suggest SHIRTS.
    function renderCompleteTheLook(focusType) {
        const section = document.getElementById('completeLook');
        const track   = document.getElementById('clTrack');
        const sub     = document.getElementById('clSub');
        if (!section || !track) return;

        const wantType = (focusType === 'shirt') ? 'pants' : 'shirt';
        if (sub) sub.innerText = (focusType === 'shirt')
            ? 'מכנסיים שמשלימים את החולצה שלך'
            : 'חולצות שמשלימות את המכנסיים שלך';

        const recs = GARMENT_CATALOG.filter(i => i.type === wantType).slice(0, 4);
        track.innerHTML = '';

        recs.forEach(item => {
            const svg = (item.type === 'shirt')
                ? shirtSVG(item.color, item.sleeve)
                : pantsSVG(item.color);
            const dataUri = svgToDataUri(svg);

            const card = document.createElement('article');
            card.className = 'cl-card';
            card.innerHTML =
                '<div class="cl-media"><img alt="' + item.name + '" src="' + dataUri + '"></div>' +
                '<div class="cl-info">' +
                    '<span class="cl-name">' + item.name + '</span>' +
                    '<span class="cl-tag">' + (item.type === 'shirt' ? 'חולצה' : 'מכנסיים') + '</span>' +
                '</div>' +
                '<button class="cl-swap" type="button">הוסף ללוק · Quick Add</button>';

            card.querySelector('.cl-swap').addEventListener('click', () => {
                // Adds the complementary garment so the user sees the full set
                // (focused shirt + these pants, or vice-versa).
                if (item.type === 'shirt') currentShirtSleeve = item.sleeve || 'short';
                else                       currentPantsFit    = item.fit    || 'regular';
                loadGarmentFromSrc(dataUri, item.type);
                track.querySelectorAll('.cl-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                placeholder.innerText = 'הלוק עודכן — ' + item.name;
            });

            track.appendChild(card);
        });

        section.hidden = false;
    }

    // Garment carried over from a store product page. It is REMEMBERED here
    // and only applied to the camera once the user finishes Screen 1 (the size
    // calculator) and continues to Screen 2 — the size recommendation is
    // essential to the fit, so the calculator is never skipped on this flow.
    let pendingHandoff = null;

    // Apply the focused garment when the user reaches the fitting/camera screen.
    // Called from the "continue" button handler (Screen 1 → Screen 2).
    function activateFocusFitting() {
        if (!pendingHandoff) return;
        const h = pendingHandoff;

        // 1) build + activate the garment inside the camera engine
        applyHandoffGarment(h.itemType, h.subType, h.color);

        // 2) immersive layout — hide the general catalog, isolate this item
        document.body.classList.add('focus-mode');

        // 3) royal-blue focused-session status bar over the canvas
        const status = document.getElementById('focusStatus');
        if (status) {
            status.innerHTML = 'מדידת פריט ממוקדת: <strong>' + h.name + '</strong>';
            status.hidden = false;
        }

        // 4) cross-category "Complete the Look" slider
        renderCompleteTheLook(h.itemType);

        if (placeholder) placeholder.innerText = 'לחץ "הפעל מצלמה למדידה" כדי להתחיל';
    }

    (function initFocusMode() {
        const sp       = new URLSearchParams(window.location.search);
        const itemType = sp.get('itemType');
        const color    = sp.get('color');
        const subType  = sp.get('subType') || '';
        if (!itemType || !color) return;                 // no handoff → normal flow

        // embed=1 → legacy in-store iframe modal: the store handled sizing and
        // wraps this iframe with its own chrome, so jump straight to the camera.
        const embed   = sp.get('embed') === '1';
        const isShirt = (itemType === 'shirt');
        const sleeve  = SLEEVE_MAP[subType] || 'short';
        const fit     = (['slim', 'regular', 'wide'].indexOf(subType) !== -1) ? subType : 'regular';

        // resolve display name: URL > localStorage handoff > generated
        let itemName = sp.get('name');
        if (!itemName) {
            try { const t = JSON.parse(localStorage.getItem('pear_tryon') || 'null'); if (t && t.name) itemName = t.name; } catch (e) {}
        }
        if (!itemName) {
            const fitHe = isShirt
                ? ({ short: 'שרוול קצר', long: 'שרוול ארוך', sleeveless: 'גופייה' }[sleeve])
                : ({ slim: 'צמוד', regular: 'רגיל', wide: 'רחב' }[fit]);
            itemName = (isShirt ? 'חולצה' : 'מכנסיים') + ' · ' + fitHe;
        }

        pendingHandoff = { itemType, subType, color, name: itemName };

        if (embed) {
            // Legacy embedded flow — skip the calculator, suppress in-iframe chrome.
            document.body.classList.add('focus-mode', 'embed-mode');
            applyHandoffGarment(itemType, subType, color);
            screenCalc.classList.remove('active');
            screenFit.classList.add('active');
            placeholder.innerText = 'לחץ "הפעל מצלמה למדידה" כדי להתחיל';
            return;
        }

        // Product-page flow (full redirect): KEEP Screen 1 (calculator) first.
        // Surface a banner so the user knows which item is queued while they
        // enter their measurements; the garment is applied on "continue".
        const hint = document.getElementById('focusCalcHint');
        if (hint) {
            hint.innerHTML = 'מודדים עבור: <strong>' + itemName + '</strong> — חשבו מידה והמשיכו לחדר המדידה';
            hint.hidden = false;
        }
    })();

    // Live swap from the store overlay (no reload → camera keeps running).
    window.addEventListener('message', (ev) => {
        const d = ev.data;
        if (!d || d.type !== 'pear:swap') return;
        applyHandoffGarment(d.itemType, d.subType || '', d.color || '');
        const status = document.getElementById('focusStatus');
        if (status && !status.hidden && d.name) {
            status.innerHTML = 'מדידת פריט ממוקדת: <strong>' + d.name + '</strong>';
        }
        if (placeholder && d.name) placeholder.innerText = 'הלוק עודכן — ' + d.name;
    });
