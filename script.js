(function() {
    'use strict';

    // DOM Elements
    const video = document.getElementById('video');
    const urlInput = document.getElementById('urlInput');
    const loadBtn = document.getElementById('loadBtn');
    const shareBtn = document.getElementById('shareBtn');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const streamInfo = document.getElementById('streamInfo');
    const copyNotification = document.getElementById('copyNotification');
    const testStreamBtns = document.querySelectorAll('.test-stream-btn');

    // State
    let hls = null;
    const DEFAULT_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

    // Utility
    function getShareableUrl(streamUrl) {
        const baseUrl = window.location.origin + window.location.pathname;
        return `${baseUrl}?stream=${encodeURIComponent(streamUrl)}`;
    }

    // UI Updates
    function updateStatus(type, message) {
        statusDot.className = 'status-dot';
        if (type === 'active') {
            statusDot.classList.add('active');
        } else if (type === 'error') {
            statusDot.classList.add('error');
        }
        statusText.textContent = message;
    }

    function showCopyNotification() {
        copyNotification.classList.add('visible');
        // Удаляем класс через 2 секунды
        clearTimeout(window._copyTimeout);
        window._copyTimeout = setTimeout(() => {
            copyNotification.classList.remove('visible');
        }, 2000);
    }

    // Player Management
    function destroyPlayer() {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
    }

    function loadStream(url) {
        if (!url) {
            updateStatus('idle', 'Введите ссылку на поток');
            return;
        }

        destroyPlayer();
        
        urlInput.value = url;
        streamInfo.textContent = 'Загрузка...';
        updateStatus('idle', 'Подключение к потоку...');
        
        // Update URL without reloading
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
                video.play().catch(() => {
                    console.log('Автовоспроизведение заблокировано браузером');
                });
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
                            updateStatus('error', 'Критическая ошибка воспроизведения');
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
            
        // Native HLS support (Safari)
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', function() {
                updateStatus('active', 'Нативное HLS воспроизведение');
                streamInfo.textContent = 'Встроенный HLS плеер';
            });
            video.play().catch(() => {
                console.log('Автовоспроизведение заблокировано браузером');
            });
            
        // No HLS support
        } else {
            updateStatus('error', 'HLS не поддерживается браузером');
            streamInfo.textContent = '❌ Не поддерживается';
        }
    }

    // Fallback: копирование через старый метод
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
            console.error('Fallback copy failed:', err);
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }

    // Event Handlers
    function handleShare() {
        const currentUrl = urlInput.value;
        if (!currentUrl) {
            alert('Нет загруженного потока для шаринга');
            return;
        }
        
        const shareUrl = getShareableUrl(currentUrl);
        
        // Пробуем Web Share API (мобильные устройства)
        if (navigator.share) {
            navigator.share({
                title: 'HLS Stream',
                text: 'Смотри HLS поток',
                url: shareUrl
            }).then(() => {
                console.log('Успешно поделились');
            }).catch((err) => {
                // Пользователь отменил или ошибка — пробуем копировать
                if (err.name !== 'AbortError') {
                    copyToClipboard(shareUrl);
                }
            });
        } else {
            // Десктоп: копируем в буфер обмена
            copyToClipboard(shareUrl);
        }
    }

    function copyToClipboard(text) {
        // Современный метод
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showCopyNotification();
            }).catch(() => {
                // Если не получилось — fallback
                if (fallbackCopy(text)) {
                    showCopyNotification();
                } else {
                    alert('Не удалось скопировать ссылку. Вот она:\n' + text);
                }
            });
        } else {
            // Старый метод для старых браузеров
            if (fallbackCopy(text)) {
                showCopyNotification();
            } else {
                alert('Не удалось скопировать ссылку. Вот она:\n' + text);
            }
        }
    }

    function handleLoadClick() {
        loadStream(urlInput.value.trim());
    }

    function handleInputKeypress(e) {
        if (e.key === 'Enter') {
            loadStream(urlInput.value.trim());
        }
    }

    function handleTestStreamClick() {
        const url = this.getAttribute('data-url');
        loadStream(url);
    }

    function handlePopState(e) {
        if (e.state && e.state.stream) {
            loadStream(e.state.stream);
        }
    }

    // Initialize from URL parameters
    function initFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const streamParam = params.get('stream');
        if (streamParam) {
            loadStream(decodeURIComponent(streamParam));
        } else {
            loadStream(DEFAULT_STREAM);
        }
    }

    // Event Listeners
    loadBtn.addEventListener('click', handleLoadClick);
    urlInput.addEventListener('keypress', handleInputKeypress);
    shareBtn.addEventListener('click', handleShare);
    testStreamBtns.forEach(btn => {
        btn.addEventListener('click', handleTestStreamClick);
    });
    window.addEventListener('popstate', handlePopState);

    // Initialize
    initFromUrl();
})();
