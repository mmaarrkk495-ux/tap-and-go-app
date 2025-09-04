// --- DATA FROM YOUR EXPERIMENT ---
const psiData = [
    { psi: 105, freq: 98.0 }, 
    { psi: 100, freq: 95.2 }, { psi: 95, freq: 92.2 }, { psi: 90, freq: 88 },
    { psi: 85, freq: 85 }, { psi: 80, freq: 84.2 }, { psi: 75, freq: 82.8 },
    { psi: 70, freq: 82.2 }, { psi: 65, freq: 82 }, { psi: 60, freq: 79.8 },
    { psi: 55, freq: 77.2 }, { psi: 50, freq: 73 }, { psi: 45, freq: 70 },
    { psi: 40, freq: 67.6 }, { psi: 35, freq: 65.4 }, { psi: 30, freq: 64 },
    { psi: 25, freq: 64 }, { psi: 20, freq: 64 }
];

// --- DOM Element References ---
const measureButton = document.getElementById('measureButton');
const statusDiv = document.getElementById('status').querySelector('p');
const resultText = document.getElementById('resultText');
const frequencyText = document.getElementById('frequencyText');
const psiText = document.getElementById('psiText');
const volumeBar = document.getElementById('volumeBar');
const wheelIcon = document.getElementById('wheelIcon');

// --- State Management ---
let audioContext;
let analyser;
let microphone;
let isListening = false;
let animationFrameId;

// --- Thresholds ---
const MAX_FREQ_LIMIT = 125;
let dynamicKnockThreshold = 200;

// --- Event Listeners ---
measureButton.addEventListener('click', () => {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            statusDiv.textContent = 'เบราว์เซอร์ของคุณไม่รองรับ Web Audio API';
            return;
        }
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
});

function findNearestPSI(freq) {
    return psiData.reduce((prev, curr) => 
        Math.abs(curr.freq - freq) < Math.abs(prev.freq - freq) ? curr : prev
    ).psi;
}

async function startListening() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusDiv.textContent = 'เบราว์เซอร์ไม่รองรับการเข้าถึงไมโครโฟน';
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        microphone = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.1;
        microphone.connect(analyser);
        isListening = true;
        calibrateAndListen();
    } catch (err) {
        statusDiv.textContent = 'ไม่สามารถเข้าถึงไมโครโฟนได้';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            statusDiv.textContent = 'คุณต้องอนุญาตให้ใช้ไมโครโฟน';
        }
    }
}

function calibrateAndListen() {
    updateUIMode('calibrating');
    const calibrationTime = 1000;
    const sampleInterval = 100;
    let samples = [];
    const calibrationInterval = setInterval(() => {
        const timeDomainData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(timeDomainData);
        samples.push(Math.max(...timeDomainData));
    }, sampleInterval);

    setTimeout(() => {
        clearInterval(calibrationInterval);
        const ambientNoiseLevel = samples.reduce((a, b) => a + b, 0) / samples.length;
        dynamicKnockThreshold = (ambientNoiseLevel * 1.5) + 25; 
        updateUIMode('listening');
        detectKnock();
    }, calibrationTime);
}

function stopListening() {
    if (microphone) {
        microphone.mediaStream.getTracks().forEach(track => track.stop());
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    isListening = false;
    updateUIMode('idle');
}

function detectKnock() {
    const timeDomainData = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
        analyser.getByteTimeDomainData(timeDomainData);
        const maxAmplitude = Math.max(...timeDomainData);
        volumeBar.style.width = `${(maxAmplitude / 255) * 100}%`;
        if (maxAmplitude > dynamicKnockThreshold) {
            analyzeFrequency();
            stopListening();
        } else {
            animationFrameId = requestAnimationFrame(check);
        }
    };
    check();
}

function analyzeFrequency() {
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(frequencyData);

    const hpsSpectrum = new Float32Array(frequencyData.length);
    const harmonicsToProcess = 5; 

    for (let i = 0; i < frequencyData.length; i++) {
        hpsSpectrum[i] = frequencyData[i];
    }

    for (let h = 2; h <= harmonicsToProcess; h++) {
        for (let i = 0; i < frequencyData.length / h; i++) {
            hpsSpectrum[i] *= frequencyData[i * h];
        }
    }
    
    const relevantMinHz = 60;
    const relevantMaxHz = 200;
    const nyquist = audioContext.sampleRate / 2;
    const minIndex = Math.round((relevantMinHz / nyquist) * hpsSpectrum.length);
    const maxIndexBound = Math.round((relevantMaxHz / nyquist) * hpsSpectrum.length);

    let maxVal = -1;
    let maxBin = -1;

    for (let i = minIndex; i < maxIndexBound; i++) {
        if (hpsSpectrum[i] > maxVal) {
            maxVal = hpsSpectrum[i];
            maxBin = i;
        }
    }
    
    const peakFrequency = maxBin * audioContext.sampleRate / analyser.fftSize;
    displayResult(peakFrequency);
}

function displayResult(frequency) {
    const freq = Math.round(frequency);
    const psi = findNearestPSI(freq);
    let statusText = '';
    
    wheelIcon.classList.remove('text-gray-200', 'text-red-400');

    if (freq > MAX_FREQ_LIMIT) {
        statusText = 'วัดค่าอีกครั้ง';
        resultText.style.color = '#4F46E5';
        wheelIcon.classList.add('text-blue-500');
        frequencyText.textContent = `${freq} Hz`;
        psiText.textContent = '-';
    } 
    else if (freq > 95.2 || psi > 100) {
        statusText = 'ลมแข็ง';
        resultText.style.color = '#EF4444';
        wheelIcon.classList.add('text-red-500');
        frequencyText.textContent = `${freq} Hz`;
        psiText.textContent = '> 100 PSI';
    }
    else {
        frequencyText.textContent = `${freq} Hz`;
        psiText.textContent = `${psi} PSI`;

        if (psi >= 80 && psi <= 100) {
            statusText = 'ปกติ';
            resultText.style.color = '#22C55E';
            wheelIcon.classList.add('text-green-500');
        } else {
            statusText = 'ลมอ่อน';
            resultText.style.color = '#F97316';
            wheelIcon.classList.add('text-orange-500');
        }
    }
    resultText.textContent = statusText;
}

function updateUIMode(mode) {
    measureButton.disabled = false;
    measureButton.classList.remove('bg-blue-600', 'hover:bg-blue-700', 'bg-red-600', 'hover:bg-red-700');
    
    switch(mode) {
        case 'calibrating':
            wheelIcon.classList.remove('text-gray-200', 'text-green-500', 'text-red-500', 'text-orange-500', 'text-blue-500');
            wheelIcon.classList.add('spinning', 'text-red-400');
            statusDiv.textContent = 'กำลังปรับเทียบเสียงรบกวน...';
            measureButton.textContent = 'กำลังฟัง... (กดเพื่อยกเลิก)';
            measureButton.classList.add('bg-red-600');
            measureButton.disabled = true;
            break;
        case 'listening':
            statusDiv.textContent = 'รอเสียงเคาะ...';
            measureButton.textContent = 'กำลังฟัง... (กดเพื่อยกเลิก)';
            measureButton.classList.add('bg-red-600', 'hover:bg-red-700');
            measureButton.disabled = false;
            break;
        case 'idle':
        default:
            statusDiv.textContent = 'กดปุ่ม "เริ่มวัดเสียง"';
            measureButton.textContent = 'เริ่มวัดเสียง';
            measureButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
            volumeBar.style.width = '0%';
            wheelIcon.classList.remove('spinning', 'text-red-400');
            const hasResultColor = ['text-green-500', 'text-red-500', 'text-orange-500', 'text-blue-500'].some(c => wheelIcon.classList.contains(c));
            if (!hasResultColor) {
                wheelIcon.classList.add('text-gray-200');
            }
            break;
    }
}
