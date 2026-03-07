document.addEventListener('DOMContentLoaded', () => {

    // ── Element References ──────────────────────────────────────
    const topicInput = document.getElementById('topicInput');
    const planBtn = document.getElementById('planBtn');
    const planCard = document.getElementById('planCard');
    const subTopicList = document.getElementById('subTopicList');
    const vibeStrip = document.getElementById('vibeStrip');
    const realGenerateBtn = document.getElementById('realGenerateBtn');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingStatus = document.getElementById('loadingStatus');

    const previewSection = document.getElementById('previewSection');
    const presentationPreview = document.getElementById('presentationPreview');

    const deckOptions = document.getElementById('deckOptions');

    // Hidden file input for manual image uploads
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // ── State ───────────────────────────────────────────────────
    let selectedVibe = 'modern';
    let selectedScale = 7;
    let deckState = { topic: '', slides: [] };

    // ── AI Helpers ───────────────────────────────────────────────
    async function fetchPollinationsJSON(prompt, systemMsg, retryCount = 0) {
        const MAX_RETRIES = 3;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
            const seed = Math.floor(Math.random() * 100000);
            const cleanPrompt = `${prompt} JSON Format: ${systemMsg}`;
            const url = `https://text.pollinations.ai/${encodeURIComponent(cleanPrompt.substring(0, 500))}?model=openai&json=true&seed=${seed}`;

            const res = await fetch(url, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (res.status === 429 && retryCount < MAX_RETRIES) {
                const backoff = Math.pow(2, retryCount) * 1500 + Math.random() * 1000;
                showLoading(`Server busy, retrying in ${Math.round(backoff / 1000)}s...`);
                await new Promise(r => setTimeout(r, backoff));
                return fetchPollinationsJSON(prompt, systemMsg, retryCount + 1);
            }

            if (!res.ok) {
                throw new Error(`API returned ${res.status}`);
            }

            const text = await res.text();

            // Helper to clean and parse JSON
            const tryParse = (str) => {
                const firstBrace = str.indexOf('{');
                const lastBrace = str.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) {
                    try {
                        return JSON.parse(str.substring(firstBrace, lastBrace + 1));
                    } catch (_) { }
                }

                const arrStart = str.indexOf('['), arrEnd = str.lastIndexOf(']');
                if (arrStart !== -1 && arrEnd !== -1) {
                    try {
                        return { bulletPoints: JSON.parse(str.substring(arrStart, arrEnd + 1)) };
                    } catch (_) { }
                }
                return null;
            };

            const data = tryParse(text);
            if (data) return data;

            // If we're here, parsing failed. Retry with a different seed.
            if (retryCount < MAX_RETRIES) {
                showLoading(`Refining response (${retryCount + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, 1000));
                return fetchPollinationsJSON(prompt, systemMsg, retryCount + 1);
            }

            throw new Error("Could not parse API response");
        } catch (e) {
            clearTimeout(timeout);
            if ((e.name === 'AbortError' || e.message.includes('timeout')) && retryCount < MAX_RETRIES) {
                showLoading(`Request timed out, retrying...`);
                await new Promise(r => setTimeout(r, 1000));
                return fetchPollinationsJSON(prompt, systemMsg, retryCount + 1);
            }
            throw e;
        }
    }

    function getImageUrl(topic, subTopic, seed = 0) {
        // Simplify prompt by removing special characters that might confuse the generator
        const cleanSub = (subTopic || '').replace(/[:;,\-]/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanTopic = (topic || '').replace(/[:;,\-]/g, ' ').replace(/\s+/g, ' ').trim();

        // Add vibe context to prompt
        const vibes = {
            modern: 'professional presentation slide digital art sleak modern',
            cyberpunk: 'cyberpunk neon futuristic digital art synthwave',
            classic: 'classic elegant oil painting masterpiece vintage',
            botanic: 'botanic nature green plants photography high quality',
            minimalist: 'minimalist clean simple design professional'
        };
        const vibePrompt = vibes[selectedVibe] || vibes.modern;

        const prompt = cleanSub ? `${cleanSub} for ${cleanTopic}` : cleanTopic;
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ' ' + vibePrompt)}?width=1280&height=720&nologo=true&seed=${seed}`;
    }

    function getFallbackImageUrl(topic, subTopic) {
        const query = (subTopic || topic || 'presentation').replace(/\s+/g, ',');
        return `https://loremflickr.com/1280/720/${encodeURIComponent(query)}`;
    }



    // ── Scale Pickers ───────────────────────────────────────────
    function setupScalePicker(containerId, setter) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('.count-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.count-chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                setter(parseInt(btn.dataset.val));
            });
        });
    }
    setupScalePicker('deckScaleChips', v => selectedScale = v);

    // ── Branding Toggle ─────────────────────────────────────────
    const brandingChip = document.getElementById('brandingChip');
    const showBrandingCheck = document.getElementById('showBranding');
    if (brandingChip && showBrandingCheck) {
        brandingChip.addEventListener('click', () => {
            const isOn = brandingChip.classList.toggle('active');
            showBrandingCheck.checked = isOn;
        });
    }

    // ── Theme / Vibe ────────────────────────────────────────────
    document.querySelectorAll('.theme-opt').forEach(opt => {
        opt.addEventListener('click', () => {
            applyVibe(opt.dataset.theme);
            document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
        });
    });

    function applyVibe(vibe) {
        selectedVibe = vibe;
        deckState.vibe = vibe;
        document.documentElement.setAttribute('data-vibe', vibe);
        document.body.setAttribute('data-vibe', vibe);
        vibeStrip.querySelectorAll('.vibe-swatch').forEach(s => s.classList.toggle('active', s.dataset.v === vibe));

        // Re-init charts if they exist in the current preview
        if (deckState.slides && deckState.slides.length > 0) {
            deckState.slides.forEach((s, i) => {
                if (s.layout === 'chart-slide') initChart(i, s.chartData);
            });
        }
    }

    vibeStrip.querySelectorAll('.vibe-swatch').forEach(sw => sw.addEventListener('click', () => applyVibe(sw.dataset.v)));

    // ── PLAN / GENERATE FLOW ────────────────────────────────────
    planBtn.addEventListener('click', async () => {
        const topic = topicInput.value.trim();
        if (!topic) { topicInput.focus(); return; }
        startPresentationPlanning(topic);
    });

    async function startPresentationPlanning(topic) {
        planBtn.disabled = true;
        showLoading('AI is brainstorming...');
        planCard.classList.add('hidden');
        try {
            const count = Math.min(9, Math.max(5, selectedScale));
            const systemMsg = `JSON generator. Return exactly: {"vibe": "modern", "subTopics": ["T1", "T2", "T3"... exactly ${count} items]}`;
            const data = await fetchPollinationsJSON(`Presentation topic: "${topic}". Generate ${count} clear, specific sub-topics.`, systemMsg);

            applyVibe(data.vibe || 'modern');
            subTopicList.innerHTML = '';
            (data.subTopics || []).slice(0, count).forEach(sub => addTopicRow(sub));

            hideLoading();
            planCard.classList.remove('hidden');
            planCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
            console.error(e);
            hideLoading();
            alert('Brainstorming failed. Please try again.');
        } finally { planBtn.disabled = false; }
    }



    // ── FINAL GENERATION ────────────────────────────────────────
    realGenerateBtn.addEventListener('click', async () => {
        const topic = topicInput.value.trim();
        const subTopics = Array.from(document.querySelectorAll('.planned-topic'))
            .map(i => i.value.trim()).filter(Boolean);

        if (!subTopics.length) return alert('Add at least one slide.');

        realGenerateBtn.disabled = true;
        previewSection.classList.add('hidden');

        try {
            deckState.topic = topic;
            deckState.slides = [];

            // Generate slides SEQUENTIALLY with delays to avoid rate limiting
            for (let i = 0; i < subTopics.length; i++) {
                const subTopic = subTopics[i];
                showLoading(`Generating slide ${i + 1} of ${subTopics.length}: ${subTopic}...`);

                // Add delay between requests to avoid rate limiting
                if (i > 0) {
                    await new Promise(r => setTimeout(r, 2000));
                }

                try {
                    const systemMsg = `JSON generator. Return ONLY: {"title": "exact slide title", "bulletPoints": ["Detailed point 1.", "Detailed point 2.", "Detailed point 3."]}`;
                    const aiResult = await fetchPollinationsJSON(
                        `Write 3 detailed bullet points about "${subTopic}" in the context of "${topic}".`,
                        systemMsg
                    );

                    let bulletPoints = [];
                    if (aiResult?.bulletPoints && Array.isArray(aiResult.bulletPoints) && aiResult.bulletPoints.length > 0) {
                        bulletPoints = aiResult.bulletPoints.filter(b => b && typeof b === 'string' && b.trim().length > 5);
                    }
                    if (bulletPoints.length === 0) {
                        bulletPoints = [`${subTopic} represents a key aspect of ${topic}.`, `Recent developments have transformed how we understand ${subTopic}.`, `The impact of ${subTopic} continues to shape the future of ${topic}.`];
                    }

                    const imgUrl = getImageUrl(topic, subTopic, i);

                    deckState.slides.push({
                        title: (aiResult?.title && typeof aiResult.title === 'string') ? aiResult.title : subTopic,
                        bulletPoints,
                        imageUrl: imgUrl,
                        layout: ['layout-split-left', 'layout-split-right', 'layout-top-image', 'layout-full-image'][Math.floor(Math.random() * 4)]
                    });

                    // Render incrementally so user can see/edit early slides
                    renderDeck();
                    previewSection.classList.remove('hidden');
                } catch (e) {
                    console.warn(`Slide ${i + 1} failed:`, e);
                    // Use fallback for this slide
                    deckState.slides.push({
                        title: subTopic,
                        bulletPoints: [
                            `${subTopic} is a fundamental aspect of this topic.`,
                            `Understanding ${subTopic} provides valuable insights.`,
                            `Focus on ${subTopic} continues to drive progress.`
                        ],
                        imageUrl: getImageUrl(topic, subTopic, i),
                        layout: ['layout-split-left', 'layout-split-right', 'layout-top-image', 'layout-full-image'][Math.floor(Math.random() * 4)]
                    });
                    renderDeck();
                    previewSection.classList.remove('hidden');
                }
            }

            // Chart slide
            showLoading('Generating data visualization...');
            await new Promise(r => setTimeout(r, 2000)); // Delay before chart request

            try {
                const systemMsg = `JSON analyst. Return ONLY valid JSON: {"title": "string", "type": "bar", "labels": ["Label1","Label2","Label3","Label4","Label5"], "values": [number, number, number, number, number]}`;
                const data = await fetchPollinationsJSON(`Generate 5 quantitative data points about "${topic}".`, systemMsg);

                const chartData = {
                    title: (typeof data.title === 'string' ? data.title : `${topic} Data`).substring(0, 80),
                    type: ['bar', 'line', 'doughnut'].includes(data.type) ? data.type : 'bar',
                    labels: Array.isArray(data.labels) ? data.labels.slice(0, 8).map(l => String(l)) : ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
                    values: Array.isArray(data.values) ? data.values.slice(0, 8).map(v => {
                        const n = Number(v);
                        return isNaN(n) ? 0 : n;
                    }) : [20, 35, 45, 60, 75]
                };

                if (chartData.labels?.length > 0) {
                    deckState.slides.push({
                        title: chartData.title || `${topic} Data`,
                        layout: 'chart-slide',
                        chartData: chartData
                    });
                }
            } catch (e) {
                console.warn('Chart generation failed:', e);
                // Fallback chart
                deckState.slides.push({
                    title: `${topic} Overview`,
                    layout: 'chart-slide',
                    chartData: { title: `${topic} Overview`, type: 'bar', labels: ['2020', '2021', '2022', '2023', '2024'], values: [23, 38, 52, 60, 71] }
                });
            }

            // Render the full deck IMMEDIATELY (Images will lazy load)
            renderDeck();
            previewSection.classList.remove('hidden');
            previewSection.scrollIntoView({ behavior: 'smooth' });
            triggerCelebration();

        } catch (e) {
            alert('Generation failed: ' + e.message);
        } finally {
            hideLoading();
            realGenerateBtn.disabled = false;
        }
    });

    function addTopicRow(val) {
        const div = document.createElement('div');
        div.className = 'topic-row';
        div.innerHTML = `<span class="topic-drag-handle">⠿</span><input type="text" class="planned-topic" value="${val}"><button class="remove-topic" onclick="this.parentElement.remove()">×</button>`;
        subTopicList.appendChild(div);
    }

    // ── RESPONSIVE SCALING ──────────────────────────────────────
    window.addEventListener('resize', () => {
        if (!previewSection.classList.contains('hidden')) renderDeck();
    });



    // ── DECK RENDERING ──────────────────────────────────────────
    function renderDeck() {
        presentationPreview.innerHTML = '';
        const W = 1920, H = 1080;
        const availableWidth = presentationPreview.clientWidth || window.innerWidth - 60;
        const scale = Math.min(0.45, availableWidth / W);

        const container = document.createElement('div');
        container.className = 'deck-container';

        // 1. Title slide
        renderSlide('title', { title: deckState.topic }, container, W, H, scale);

        // 2. Agenda slide
        const agendaItems = deckState.slides.map(s => s.title).filter(Boolean);
        if (agendaItems.length > 0) {
            renderSlide('agenda', { title: 'Overview', items: agendaItems }, container, W, H, scale);
        }

        // 3. Content slides
        deckState.slides.forEach((s, i) => renderSlide(i, s, container, W, H, scale));

        // 4. Branding slide
        if (showBrandingCheck?.checked) {
            renderSlide('branding', { title: deckState.topic }, container, W, H, scale);
        }

        presentationPreview.appendChild(container);

        // 5. Init charts AFTER DOM is ready
        setTimeout(() => {
            deckState.slides.forEach((s, i) => {
                if (s.layout === 'chart-slide') initChart(i, s.chartData);
            });
        }, 150);
    }

    function renderSlide(idx, data, container, W, H, scale) {
        const wrapper = document.createElement('div');
        wrapper.className = 'slide-wrapper';
        wrapper.style.cssText = `width:${W * scale}px; height:${H * scale}px; position:relative; flex-shrink:0;`;

        const slide = document.createElement('div');
        let layout = '';
        if (idx === 'title') layout = 'title-slide';
        else if (idx === 'agenda') layout = 'layout-agenda';
        else if (idx === 'branding') layout = 'branding-slide';
        else layout = data.layout || 'layout-split-left';

        slide.className = `slide horizontal ${layout}`;
        slide.style.cssText = `width:${W}px; height:${H}px; transform:scale(${scale}); transform-origin:top left; position:absolute; top:0; left:0;`;

        // Build content
        if (idx === 'title') {
            slide.innerHTML = `
                <h1 class="slide-title-main" contenteditable="true">${escHtml(data.title)}</h1>
                <div class="slide-subtitle-main">${escHtml(selectedVibe.charAt(0).toUpperCase() + selectedVibe.slice(1))} Presentation</div>
            `;
        } else if (idx === 'agenda') {
            const items = (data.items || []).map((it, n) =>
                `<div class="agenda-item"><span class="agenda-num">${n + 1}</span>${escHtml(it)}</div>`
            ).join('');
            slide.innerHTML = `
                <div class="slide-titlebar"><h2>${escHtml(data.title)}</h2></div>
                <div class="agenda-list">${items}</div>
            `;
        } else if (idx === 'branding') {
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('https://melnykk-dev.github.io/LateButGreat/')}`;
            slide.innerHTML = `
                <div class="branding-layout">
                    <div class="branding-content">
                        <h2 class="branding-thanks">Thank You</h2>
                        <p class="branding-author">Created with <strong>LateButGreat AI</strong></p>
                        <div class="branding-qr-wrap">
                            <img class="branding-qr" src="${qrUrl}" alt="QR Code" loading="lazy">
                            <p class="qr-hint">melnykk-dev.github.io/LateButGreat</p>
                        </div>
                        <p class="branding-by">Topic: ${escHtml(data.title)}</p>
                    </div>
                </div>
            `;
        } else if (layout === 'chart-slide') {
            slide.innerHTML = `
                <div class="slide-titlebar"><h2 contenteditable="true">${escHtml(data.title)}</h2></div>
                <div class="chart-canvas-wrap" style="flex:1; padding: 30px 60px; position:relative;">
                    <canvas id="chart-${idx}" style="width:100%; height:100%;"></canvas>
                </div>
            `;
        } else if (layout === 'layout-top-image') {
            const bullets = (data.bulletPoints || []).map((b, bIdx) =>
                `<li contenteditable="true" onblur="window.updateBullet(${idx},${bIdx},this.innerText)">${escHtml(b)}</li>`
            ).join('');

            const imgHtml = data.imageUrl
                ? `<div class="top-img-wrap loading">
                     <div class="img-placeholder">✦ Generating visual...</div>
                     <img src="${escHtml(data.imageUrl)}" alt="slide visual" 
                        onload="this.parentElement.classList.remove('loading')" 
                        onerror="if(!this.dataset.fallback){ this.dataset.fallback=true; this.src='${getFallbackImageUrl(deckState.topic, data.title)}'; } else { this.previousElementSibling.innerText='Visual unavailable'; this.parentElement.classList.remove('loading'); this.remove(); }">
                   </div>`
                : '';

            slide.innerHTML = `
                ${imgHtml}
                <div class="bottom-text-wrap">
                    <h2 contenteditable="true" onblur="window.updateTitle(${idx},this.innerText)">${escHtml(data.title)}</h2>
                    <ul>${bullets}</ul>
                </div>
            `;
        } else {
            // Standard content slide with image (split layout)
            const bullets = (data.bulletPoints || []).map((b, bIdx) =>
                `<li contenteditable="true" onblur="window.updateBullet(${idx},${bIdx},this.innerText)">${escHtml(b)}</li>`
            ).join('');

            const imgHtml = data.imageUrl
                ? `<div class="img-col loading">
                     <div class="img-placeholder">✦ Generating visual...</div>
                     <img src="${escHtml(data.imageUrl)}" alt="slide visual" 
                        onload="this.parentElement.classList.remove('loading')" 
                        onerror="if(!this.dataset.fallback){ this.dataset.fallback=true; this.src='${getFallbackImageUrl(deckState.topic, data.title)}'; } else { this.previousElementSibling.innerText='Visual unavailable'; this.parentElement.classList.remove('loading'); this.remove(); }">
                   </div>`
                : '';

            slide.innerHTML = `
                <div class="slide-titlebar"><h2 contenteditable="true" onblur="window.updateTitle(${idx},this.innerText)">${escHtml(data.title)}</h2></div>
                <div class="slide-body">
                    <div class="text-col"><ul>${bullets}</ul></div>
                    ${imgHtml}
                </div>
            `;
        }

        wrapper.appendChild(slide);

        // Magic Bar (only for content slides) - FIXED: prevent scroll on click
        if (typeof idx === 'number') {
            const magicBar = document.createElement('div');
            magicBar.className = 'magic-bar';

            // Create buttons with proper event handling
            const layoutBtn = document.createElement('button');
            layoutBtn.className = 'magic-btn';
            layoutBtn.title = 'Cycle Layout';
            layoutBtn.textContent = '⊞ Layout';
            layoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.cycleLayout(idx);
            });

            const textBtn = document.createElement('button');
            textBtn.className = 'magic-btn';
            textBtn.title = 'Regenerate Text';
            textBtn.textContent = '✦ Regen Text';
            textBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.regenText(idx, textBtn);
            });

            const imgBtn = document.createElement('button');
            imgBtn.className = 'magic-btn';
            imgBtn.title = 'Regenerate Image';
            imgBtn.textContent = '⟳ Regen Image';
            imgBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.regenImage(idx, imgBtn);
            });

            const uploadBtn = document.createElement('button');
            uploadBtn.className = 'magic-btn';
            uploadBtn.title = 'Upload Own Image';
            uploadBtn.textContent = '↑ Upload';
            uploadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.triggerUpload(idx);
            });

            magicBar.appendChild(layoutBtn);
            magicBar.appendChild(textBtn);
            magicBar.appendChild(imgBtn);
            magicBar.appendChild(uploadBtn);
            wrapper.appendChild(magicBar);

            // Add Drag & Drop listeners to image containers
            const imgContainer = slide.querySelector('.img-col, .top-img-wrap');
            if (imgContainer) {
                imgContainer.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    imgContainer.classList.add('drag-over');
                });
                imgContainer.addEventListener('dragleave', () => imgContainer.classList.remove('drag-over'));
                imgContainer.addEventListener('drop', (e) => {
                    e.preventDefault();
                    imgContainer.classList.remove('drag-over');
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                        handleImageUpload(idx, file);
                    }
                });
            }
        }

        container.appendChild(wrapper);
    }

    // ── CHART INIT (Chart.js) ───────────────────────────────────
    function initChart(idx, data) {
        const canvas = document.getElementById(`chart-${idx}`);
        if (!canvas || !data) return;

        // Destroy old instance
        const old = Chart.getChart(canvas);
        if (old) old.destroy();

        // Colors from current vibe
        const vibePalettes = {
            modern: ['#6d5dfc', '#0dd9c3', '#8b7cfd', '#f59e0b', '#3b82f6'],
            classic: ['#d4af37', '#8b5a2b', '#cdaa7d', '#8b4513', '#eecfa1'],
            cyberpunk: ['#ff00ff', '#00ffff', '#ffff00', '#ff0055', '#39ff14'],
            botanic: ['#10b981', '#059669', '#34d399', '#fbbf24', '#047857'],
            minimalist: ['#555555', '#888888', '#aaaaaa', '#333333', '#dddddd']
        };
        const textColors = {
            modern: '#0f172a',
            classic: '#2c2415',
            cyberpunk: '#00ffff',
            botanic: '#064e3b',
            minimalist: '#111111'
        };
        const palette = vibePalettes[selectedVibe] || vibePalettes.modern;
        const txt = textColors[selectedVibe] || '#0f172a';
        const gridCol = selectedVibe === 'cyberpunk' ? 'rgba(0,255,255,0.15)' : 'rgba(0,0,0,0.1)';

        const values = (data.values || []).map(v => Number(v)).filter(v => !isNaN(v));
        const labels = (data.labels || []).slice(0, values.length);

        const bgColors = values.map((_, i) => palette[i % palette.length] + 'E6');
        const borderColors = values.map((_, i) => palette[i % palette.length]);

        new Chart(canvas, {
            type: data.type || 'bar',
            data: {
                labels,
                datasets: [{
                    label: data.title || 'Data',
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 3,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 600 },
                events: [], // Static chart
                plugins: {
                    tooltip: { enabled: false }, // No hover tooltips
                    legend: {
                        display: true,
                        labels: { color: txt, font: { size: 24, family: 'DM Sans', weight: 'bold' } }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: txt, font: { size: 20, weight: 'bold' } },
                        grid: { color: gridCol }
                    },
                    x: {
                        ticks: { color: txt, font: { size: 20, weight: 'bold' } },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // ── INTERACTIVE HELPERS ─────────────────────────────────────
    window.updateTitle = (idx, val) => {
        if (deckState.slides[idx]) deckState.slides[idx].title = val;
    };

    window.updateBullet = (idx, bIdx, val) => {
        if (deckState.slides[idx]?.bulletPoints?.[bIdx] !== undefined) {
            deckState.slides[idx].bulletPoints[bIdx] = val;
        }
    };

    window.cycleLayout = (idx) => {
        const slide = deckState.slides[idx];
        if (!slide || slide.layout === 'chart-slide') return;
        const layouts = ['layout-split-left', 'layout-split-right', 'layout-top-image', 'layout-full-image', 'layout-full-text'];
        const cur = layouts.indexOf(slide.layout || 'layout-split-left');
        slide.layout = layouts[(cur + 1) % layouts.length];
        renderDeck();
    };

    window.regenText = async (idx, btn) => {
        const currentScroll = window.scrollY; // Save scroll position
        const slide = deckState.slides[idx];
        if (!slide || btn.classList.contains('is-loading')) return;
        btn.classList.add('is-loading');
        btn.textContent = '...';
        try {
            const systemMsg = `JSON generator. Return ONLY: {"title": "${slide.title}", "bulletPoints": ["Point 1.", "Point 2.", "Point 3."]}`;
            const data = await fetchPollinationsJSON(`Write 3 fresh, detailed bullet points about "${slide.title}" for a presentation on "${deckState.topic}".`, systemMsg);

            if (data.bulletPoints?.length) {
                slide.bulletPoints = data.bulletPoints;
                if (data.title) slide.title = data.title;
                renderDeck();
                window.scrollTo(0, currentScroll); // Restore scroll position
            }
        } catch (e) {
            console.error(e);
            slide.bulletPoints = [`Fresh insight on ${slide.title}.`, `Updated data for ${deckState.topic}.`, `Ongoing developments in this field.`];
            renderDeck();
            window.scrollTo(0, currentScroll);
        }
        finally { btn.classList.remove('is-loading'); btn.innerHTML = '✦ Regen Text'; }
    };

    window.regenImage = async (idx, btn) => {
        const currentScroll = window.scrollY; // Save scroll position
        const slide = deckState.slides[idx];
        if (!slide || btn.classList.contains('is-loading')) return;
        btn.classList.add('is-loading');
        btn.textContent = '...';
        try {
            const seed = Date.now() % 100000;
            slide.imageUrl = getImageUrl(deckState.topic, slide.title, seed);
            delete slide.customImage; // Clear manual upload flag if user explicitly regens
            renderDeck();
            window.scrollTo(0, currentScroll); // Restore scroll position
        } catch (e) { console.error(e); }
        finally { btn.classList.remove('is-loading'); btn.innerHTML = '⟳ Regen Image'; }
    };

    window.triggerUpload = (idx) => {
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) handleImageUpload(idx, file);
        };
        fileInput.click();
    };

    function handleImageUpload(idx, file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (deckState.slides[idx]) {
                deckState.slides[idx].imageUrl = e.target.result;
                deckState.slides[idx].customImage = true; // Mark as custom to prevent auto-overwrites
                renderDeck();
            }
        };
        reader.readAsDataURL(file);
    }

    // ── EXPORT / PDF ────────────────────────────────────────────
    document.getElementById('exportBtn')?.addEventListener('click', async (e) => {
        const btn = e.target;
        const originalText = btn.innerHTML;
        btn.innerHTML = 'Generating PDF...';
        btn.disabled = true;

        try {
            const slides = document.querySelectorAll('.slide-wrapper .slide');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
                orientation: 'landscape',
                unit: 'px',
                format: [1920, 1080],
                hotfixes: ['px_scaling']
            });

            // Dedicated container for invisible rendering
            const renderContainer = document.createElement('div');
            renderContainer.style.cssText = 'position:fixed; left:-9999px; top:0; width:1920px; height:1080px; overflow:hidden; background:#000; z-index:-1;';
            document.body.appendChild(renderContainer);

            for (let i = 0; i < slides.length; i++) {
                btn.innerHTML = `Exporting Slide ${i + 1}/${slides.length}...`;

                const slide = slides[i];
                const clone = slide.cloneNode(true);

                // CRITICAL: Reset transform and ensure full size for capture
                clone.style.cssText = 'width:1920px; height:1080px; transform:none !important; position:relative; top:0; left:0; margin:0; border-radius:0; box-shadow:none; filter:none; overflow:hidden;';

                // Remove interactive elements from PDF
                clone.querySelectorAll('.magic-bar, .magic-btn').forEach(el => el.remove());

                // Sync canvases (charts)
                const origCanvases = slide.querySelectorAll('canvas');
                const cloneCanvases = clone.querySelectorAll('canvas');
                for (let c = 0; c < origCanvases.length; c++) {
                    cloneCanvases[c].width = origCanvases[c].width;
                    cloneCanvases[c].height = origCanvases[c].height;
                    const ctx = cloneCanvases[c].getContext('2d');
                    if (ctx) ctx.drawImage(origCanvases[c], 0, 0);
                }

                renderContainer.innerHTML = '';
                renderContainer.appendChild(clone);

                // Allow a moment for browsers to paint the clone
                await new Promise(r => setTimeout(r, 150));

                const canvas = await html2canvas(clone, {
                    scale: 1,
                    useCORS: true,
                    allowTaint: true,
                    width: 1920,
                    height: 1080,
                    backgroundColor: null,
                    logging: false
                });

                const imgData = canvas.toDataURL('image/jpeg', 0.9);

                if (i > 0) pdf.addPage([1920, 1080], 'landscape');
                pdf.addImage(imgData, 'JPEG', 0, 0, 1920, 1080);
            }

            document.body.removeChild(renderContainer);
            pdf.save(`${deckState.topic || 'Presentation'}.pdf`);
        } catch (err) {
            console.error('PDF Export Error:', err);
            alert('Failed to generate PDF. Check console for details.');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    });

    // ── UTILS ───────────────────────────────────────────────────
    function escHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showLoading(m) {
        loadingStatus.textContent = m;
        loadingIndicator.classList.add('visible');
    }

    function hideLoading() {
        loadingIndicator.classList.remove('visible');
    }

    function triggerCelebration() {
        const overlay = document.getElementById('celebrationOverlay');
        if (!overlay) return;
        overlay.innerHTML = '';
        const colors = ['#6d5dfc', '#0dd9c3', '#ffd700', '#ff69b4'];
        for (let i = 0; i < 40; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.cssText = `
                left: ${Math.random() * 100}vw;
                top: ${Math.random() * 40}vh;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                transform: rotate(${Math.random() * 360}deg);
                animation-delay: ${Math.random() * 0.5}s;
            `;
            overlay.appendChild(piece);
        }
        setTimeout(() => overlay.innerHTML = '', 1500);
    }
});
