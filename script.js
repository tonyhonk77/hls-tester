(function() {
    'use strict';

    // ==================== DOM Elements ====================
    const video = document.getElementById('video');
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const urlInput = document.getElementById('urlInput');
    const loadBtn = document.getElementById('loadBtn');
    const inspectBtn = document.getElementById('inspectBtn');
    const shareBtn = document.getElementById('shareBtn');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const streamInfo = document.getElementById('streamInfo');
    const panelContent = document.getElementById('panelContent');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const copyNotification = document.getElementById('copyNotification');
    const testStreamBtns = document.querySelectorAll('.btn-test');

    // ==================== State ====================
    let hls = null;
    let currentUrl = '';
    const EMPTY_URL_MESSAGE = 'Вставьте ссылку на поток, либо выберите один из тестовых!';

    // ==================== Utility Functions ====================
    function getShareableUrl(streamUrl) {
        const baseUrl = window.location.origin + window.location.pathname;
        return `${baseUrl}?stream=${streamUrl}`;
    }

    function showLoading(text = 'Загрузка...') {
        loadingText.textContent = text;
        loadingOverlay.classList.add('visible');
    }

    function hideLoading() {
        loadingOverlay.classList.remove('visible');
    }

    function updateStatus(type, message) {
        statusDot.className = 'status-dot';
        if (type === 'active') statusDot.classList.add('active');
        else if (type === 'error') statusDot.classList.add('error');
        else if (type === 'warning') statusDot.classList.add('warning');
        statusText.textContent = message;
    }

    function showCopyNotification() {
        copyNotification.classList.add('visible');
        clearTimeout(window._copyTimeout);
        window._copyTimeout = setTimeout(() => {
            copyNotification.classList.remove('visible');
        }, 2000);
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
            return true;
        } catch (err) {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(showCopyNotification).catch(() => {
                if (fallbackCopy(text)) showCopyNotification();
                else alert('Не удалось скопировать ссылку. Вот она:\n' + text);
            });
        } else {
            if (fallbackCopy(text)) showCopyNotification();
            else alert('Не удалось скопировать ссылку. Вот она:\n' + text);
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==================== Inspector Panel ====================
    function clearInspector() {
        panelContent.innerHTML = `
            <div class="panel-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p>Нажмите <strong>Inspect</strong> для анализа потока</p>
            </div>
        `;
    }

    // ==================== HLS Validation & Inspection ====================
    async function fetchPlaylist(url) {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, */*' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return await response.text();
    }

    function parsePlaylist(content, url) {
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        const info = {
            type: 'unknown',
            version: null,
            targetDuration: null,
            mediaSequence: null,
            isLive: true,
            hasEndList: false,
            variants: [],
            tags: [],
            totalDuration: 0,
            codecs: new Set(),
            resolutions: [],
            bandwidths: [],
            raw: content
        };

        for (const line of lines) {
            if (line.startsWith('#EXT')) {
                const tagName = line.split(':')[0];
                if (!info.tags.includes(tagName)) info.tags.push(tagName);
            }

            if (line.startsWith('#EXT-X-VERSION:')) {
                info.version = parseInt(line.split(':')[1]);
            }
            if (line.startsWith('#EXT-X-TARGETDURATION:')) {
                info.targetDuration = parseInt(line.split(':')[1]);
            }
            if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                info.mediaSequence = parseInt(line.split(':')[1]);
            }
            if (line.startsWith('#EXT-X-ENDLIST')) {
                info.hasEndList = true;
                info.isLive = false;
            }
            if (line.startsWith('#EXTINF:')) {
                info.type = 'media';
                const dur = parseFloat(line.split(':')[1].split(',')[0]);
                if (!isNaN(dur)) info.totalDuration += dur;
            }
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                info.type = 'master';
                const attrs = {};
                line.split(':')[1].split(',').forEach(attr => {
                    const [key, value] = attr.split('=');
                    if (key && value) attrs[key.trim()] = value.replace(/"/g, '').trim();
                });
                if (attrs.BANDWIDTH) info.bandwidths.push(parseInt(attrs.BANDWIDTH));
                if (attrs.RESOLUTION) info.resolutions.push(attrs.RESOLUTION);
                if (attrs.CODECS) {
                    attrs.CODECS.split(',').forEach(c => info.codecs.add(c.trim()));
                }
                info.variants.push(attrs);
            }
            if (line.startsWith('#EXT-X-MEDIA:')) {
                const attrs = {};
                line.split(':')[1].split(',').forEach(attr => {
                    const [key, value] = attr.split('=');
                    if (key && value) attrs[key.trim()] = value.replace(/"/g, '').trim();
                });
                info.variants.push({ type: 'media', ...attrs });
            }
            if (line.startsWith('#EXT-X-INDEPENDENT-SEGMENTS')) {
                info.hasIndependentSegments = true;
            }
        }

        return info;
    }

    function renderInspectionResult(info, url) {
        const isMaster = info.type === 'master';
        const isValid = info.version !== null || info.type !== 'unknown';

        let html = '';

        // Validation Status
        html += '<div class="inspector-section">';
        html += '<h3>🔍 Статус проверки</h3>';
        html += '<div class="info-grid">';
        html += `<div class="info-item"><div class="info-label">URL</div><div class="info-value">${escapeHtml(url)}</div></div>`;
        html += `<div class="info-item"><div class="info-label">Доступность</div><div class="info-value valid">✓ Доступен</div></div>`;
        html += `<div class="info-item"><div class="info-label">Тип плейлиста</div><div class="info-value">${isMaster ? 'Master (Multivariant)' : 'Media'}</div></div>`;
        html += `<div class="info-item"><div class="info-label">Валидность</div><div class="info-value ${isValid ? 'valid' : 'invalid'}">${isValid ? '✓ Валидный HLS' : '✗ Ошибки в плейлисте'}</div></div>`;
        if (info.version) html += `<div class="info-item"><div class="info-label">Версия HLS</div><div class="info-value">v${info.version}</div></div>`;
        html += `<div class="info-item"><div class="info-label">Режим</div><div class="info-value">${info.isLive ? '🔴 Live' : '⏹ VOD'}</div></div>`;
        if (info.targetDuration) html += `<div class="info-item"><div class="info-label">Target Duration</div><div class="info-value">${info.targetDuration} сек</div></div>`;
        html += '</div></div>';

        // Stream Info (for master playlists)
        if (isMaster && info.variants.length > 0) {
            html += '<div class="inspector-section">';
            html += '<h3>📊 Варианты потоков</h3>';
            html += '<div class="info-grid">';
            
            const videoVariants = info.variants.filter(v => !v.type || v.type !== 'media');
            html += `<div class="info-item"><div class="info-label">Количество</div><div class="info-value">${videoVariants.length} видео</div></div>`;

            if (info.resolutions.length > 0) {
                html += `<div class="info-item"><div class="info-label">Разрешения</div><div class="info-value">${info.resolutions.join(', ')}</div></div>`;
            }

            if (info.bandwidths.length > 0) {
                const minBw = Math.min(...info.bandwidths);
                const maxBw = Math.max(...info.bandwidths);
                html += `<div class="info-item"><div class="info-label">Битрейты</div><div class="info-value">${Math.round(minBw/1000)} – ${Math.round(maxBw/1000)} kbps</div></div>`;
            }

            if (info.codecs.size > 0) {
                html += `<div class="info-item"><div class="info-label">Кодеки</div><div class="info-value">${[...info.codecs].join(', ')}</div></div>`;
            }

            const audioTracks = info.variants.filter(v => v.type === 'AUDIO' || v.TYPE === 'AUDIO');
            if (audioTracks.length > 0) {
                html += `<div class="info-item"><div class="info-label">Аудио дорожки</div><div class="info-value">${audioTracks.length} шт.</div></div>`;
            }

            html += '</div></div>';
        }

        // Media playlist info
        if (info.type === 'media') {
            html += '<div class="inspector-section">';
            html += '<h3>📺 Медиа плейлист</h3>';
            html += '<div class="info-grid">';
            html += `<div class="info-item"><div class="info-label">Длительность</div><div class="info-value">${info.totalDuration.toFixed(1)} сек</div></div>`;
            html += `<div class="info-item"><div class="info-label">Media Sequence</div><div class="info-value">${info.mediaSequence || 'N/A'}</div></div>`;
            html += `<div class="info-item"><div class="info-label">Endlist</div><div class="info-value">${info.hasEndList ? '✓ Да (VOD)' : '✗ Нет (Live)'}</div></div>`;
            html += '</div></div>';
        }

        // Tags found
        if (info.tags.length > 0) {
            html += '<div class="inspector-section">';
            html += '<h3>🏷 HLS Теги</h3>';
            html += '<div class="tag-list">';
            info.tags.forEach(tag => {
                html += `<span class="tag">${escapeHtml(tag)}</span>`;
            });
            html += '</div></div>';
        }

        // Raw playlist
        html += '<div class="inspector-section">';
        html += '<h3>📝 Сырой плейлист</h3>';
        html += `<div class="raw-playlist">${escapeHtml(info.raw)}</div></div>`;

        panelContent.innerHTML = html;
    }

    function showInspectionError(error, url) {
        let html = '';
        html += '<div class="inspector-section">';
        html += '<h3>🔍 Статус проверки</h3>';
        html += '<div class="info-grid">';
        html += `<div class="info-item"><div class="info-label">URL</div><div class="info-value">${escapeHtml(url)}</div></div>`;
        html += `<div class="info-item"><div class="info-label">Доступность</div><div class="info-value invalid">✗ Ошибка</div></div>`;
        html += `<div class="info-item"><div class="info-label">Причина</div><div class="info-value invalid">${escapeHtml(error.message)}</div></div>`;
        html += '</div></div>';

        panelContent.innerHTML = html;
    }

    async function inspectStream(url) {
        if (!url) {
            updateStatus('warning', 'Введите ссылку для инспекции');
            return;
        }

        showLoading('Анализ потока...');
        updateStatus('warning', 'Инспекция потока...');

        try {
            const content = await fetchPlaylist(url);
            const info = parsePlaylist(content, url);
            renderInspectionResult(info, url);
            updateStatus('active', 'Инспекция завершена');
        } catch (error) {
            showInspectionError(error, url);
            updateStatus('error', 'Ошибка инспекции');
        } finally {
            hideLoading();
        }
    }

    // ==================== Player Management ====================
    function destroyPlayer() {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
        videoPlaceholder.style.display = '';
        document.querySelector('.video-wrapper').classList.remove('playing');
    }

    function loadStream(url) {
        if (!url) {
            updateStatus('warning', EMPTY_URL_MESSAGE);
            streamInfo.textContent = '';
            return;
        }

        destroyPlayer();
        currentUrl = url;
        
        urlInput.value = url;
        streamInfo.textContent = 'Загрузка...';
        updateStatus('idle', 'Подключение к потоку...');
        
        // Clear inspector when stream changes
        clearInspector();
        
        const newUrl = getShareableUrl(url);
        window.history.pushState({ stream: url }, '', newUrl);

        // HLS.js playback
        if (Hls.isSupported()) {
            hls = new Hls({
                debug: false,
                enableWorker: true
            });
            
            hls.loadSource(url);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                updateStatus('active', 'Воспроизведение активно');
                streamInfo.textContent = `Качество: ${data.levels.length} уровней`;
                videoPlaceholder.style.display = 'none';
                document.querySelector('.video-wrapper').classList.add('playing');
                video.play().catch(() => {});
            });
            
            hls.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    switch(data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            updateStatus('error', 'Ошибка сети. Переподключение...');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            updateStatus('error', 'Ошибка медиа. Восстановление...');
                            hls.recoverMediaError();
                            break;
                        default:
                            updateStatus('error', 'Критическая ошибка');
                            destroyPlayer();
                            break;
                    }
                }
            });
            
            hls.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
                const level = hls.levels[data.level];
                if (level) {
                    streamInfo.textContent = `🎯 ${level.height}p | ${Math.round(level.bitrate / 1000)} kbps`;
                }
            });
            
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', function() {
                updateStatus('active', 'Нативное HLS');
                streamInfo.textContent = 'Встроенный плеер';
                videoPlaceholder.style.display = 'none';
                document.querySelector('.video-wrapper').classList.add('playing');
            });
            video.play().catch(() => {});
        } else {
            updateStatus('error', 'HLS не поддерживается');
            streamInfo.textContent = '❌ Не поддерживается';
        }
    }

    // ==================== Event Handlers ====================
    function handleLoadClick() {
        const url = urlInput.value.trim();
        if (!url) {
            updateStatus('warning', EMPTY_URL_MESSAGE);
            return;
        }
        loadStream(url);
    }

    function handleInspectClick() {
        const url = urlInput.value.trim();
        if (!url) {
            updateStatus('warning', 'Введите ссылку для инспекции');
            return;
        }
        inspectStream(url);
    }

    function handleInputKeypress(e) {
        if (e.key === 'Enter') {
            const url = urlInput.value.trim();
            if (!url) {
                updateStatus('warning', EMPTY_URL_MESSAGE);
                return;
            }
            loadStream(url);
        }
    }

    function handleTestStreamClick() {
        const url = this.getAttribute('data-url');
        loadStream(url);
    }

    function handleShare() {
        if (!currentUrl) {
            alert('Нет загруженного потока');
            return;
        }
        const shareUrl = window.location.href;
        if (navigator.share) {
            navigator.share({ title: 'HLS Stream', url: shareUrl }).catch(() => copyToClipboard(shareUrl));
        } else {
            copyToClipboard(shareUrl);
        }
    }

    function handlePopState(e) {
        if (e.state && e.state.stream) {
            loadStream(e.state.stream);
        } else {
            urlInput.value = '';
            currentUrl = '';
            updateStatus('idle', 'Готов к работе');
            streamInfo.textContent = '';
            destroyPlayer();
            clearInspector();
        }
    }

    // ==================== Initialize ====================
    function init() {
        const params = new URLSearchParams(window.location.search);
        const streamParam = params.get('stream');
        
        if (streamParam) {
            loadStream(streamParam);
        } else {
            urlInput.value = '';
            updateStatus('idle', 'Готов к работе');
            streamInfo.textContent = '';
        }
    }

    // ==================== Event Listeners ====================
    loadBtn.addEventListener('click', handleLoadClick);
    inspectBtn.addEventListener('click', handleInspectClick);
    urlInput.addEventListener('keypress', handleInputKeypress);
    shareBtn.addEventListener('click', handleShare);
    testStreamBtns.forEach(btn => btn.addEventListener('click', handleTestStreamClick));
    window.addEventListener('popstate', handlePopState);

    init();
})();
