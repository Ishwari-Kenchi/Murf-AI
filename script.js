document.addEventListener('DOMContentLoaded', () => {
    // Shared Elements
    const audioPlayer = document.getElementById('audioPlayer');

    // ------------------------- Tab Switching Logic -------------------------
    const tabBtns = document.querySelectorAll('.tab-btn');
    const toolContents = document.querySelectorAll('.tool-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all tabs and contents
            tabBtns.forEach(b => b.classList.remove('active'));
            toolContents.forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });

            // Add active class to clicked tab and its target content
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            const targetContent = document.getElementById(targetId);
            targetContent.classList.add('active');
            targetContent.style.display = 'flex';

            // Cleanup audio when switching tabs
            audioPlayer.pause();
            const ttsAudio = document.getElementById('ttsAudioPlayer');
            if (ttsAudio) ttsAudio.pause();
        });
    });

    // --- Helper function for audio setup ---
    async function setupMicrophone(onStopCallback, onErrorStatusCallback) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            onErrorStatusCallback("Mic API missing. Use localhost or HTTPS.");
            return null;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            let audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = []; // reset
                onStopCallback(audioBlob);
            };

            return mediaRecorder;
        } catch (err) {
            console.error('Error accessing microphone:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                onErrorStatusCallback("Microphone permission denied.");
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                onErrorStatusCallback("No microphone found.");
            } else {
                onErrorStatusCallback("Error: " + err.message);
            }
            return null;
        }
    }

    // ------------------------- 1. Speech to Text Logic (Pure STT) -------------------------
    const sttMicButton = document.getElementById('sttMicButton');
    const sttStatusIndicator = document.getElementById('sttStatusIndicator');
    const sttArea = document.getElementById('sttArea');

    if (sttMicButton && sttStatusIndicator && sttArea) {

        // 1. Detect browser speech recognition support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            updateUIStatus(sttStatusIndicator, "Speech recognition is not supported in this browser. Please use Chrome or Edge.", 'error');
            sttMicButton.disabled = true;
        } else {
            // 3. Implement speech recognition logic
            const recognition = new SpeechRecognition();
            recognition.lang = "en-US";
            recognition.continuous = false;
            recognition.interimResults = false;

            recognition.onstart = () => {
                sttMicButton.classList.add('active');
                updateUIStatus(sttStatusIndicator, 'Recording...', 'recording');
            };

            recognition.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                handleFinalSpeech(transcript);
            };

            function handleFinalSpeech(userText) {
                if (!userText || userText.trim() === "") return;

                // Step 1: show user message
                addMessageToArea(sttArea, userText, 'user');

                // Step 2: call AI
                getAIResponse(userText);
            }

            async function getAIResponse(userText) {
                try {
                    updateUIStatus(sttStatusIndicator, 'Thinking...', 'processing');
                    
                    const response = await fetch("/chat", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ message: userText })
                    });
                    
                    const data = await response.json();
                    
                    if (!data || !data.text) {
                        addMessageToArea(sttArea, "Sorry, I couldn't process that.", 'system');
                        return;
                    }
                    
                    // Step 3: display AI reply
                    addMessageToArea(sttArea, data.text, 'system');
                    
                } catch (error) {
                    console.error("Error:", error);
                    addMessageToArea(sttArea, "Something went wrong.", 'system');
                } finally {
                    updateUIStatus(sttStatusIndicator, 'Ready to record');
                }
            }

            recognition.onerror = (event) => {
                console.error("Speech recognition error:", event.error);
                sttMicButton.classList.remove('active');
                // 6. Ensure microphone permissions are handled properly
                if (event.error === 'not-allowed') {
                    updateUIStatus(sttStatusIndicator, "Microphone access denied. Please allow microphone access in your browser settings.", 'error');
                } else {
                    updateUIStatus(sttStatusIndicator, `Error: ${event.error}`, 'error');
                }
            };

            recognition.onend = () => {
                sttMicButton.classList.remove('active');
                if (sttStatusIndicator.textContent === 'Recording...') {
                    updateUIStatus(sttStatusIndicator, 'Ready to record');
                }
            };

            // 4. Connect the microphone button
            let isRecording = false;
            
            const toggleSttRecording = (e) => {
                e.preventDefault();
                if (!isRecording) {
                    try {
                        recognition.start();
                        isRecording = true;
                    } catch (err) {
                        console.log("Recognition already started");
                    }
                } else {
                    recognition.stop();
                    isRecording = false;
                }
            };
            
            sttMicButton.addEventListener('click', toggleSttRecording);
        }
    }


    // ------------------------- 2. Text to Speech Logic -------------------------
    const ttsInput = document.getElementById('ttsInput');
    const generateVoiceBtn = document.getElementById('generateVoiceBtn');
    const ttsStatus = document.getElementById('ttsStatus');
    const ttsAudioContainer = document.getElementById('ttsAudioContainer');
    const ttsAudioPlayer = document.getElementById('ttsAudioPlayer');

    if (generateVoiceBtn) {
        generateVoiceBtn.addEventListener('click', async () => {
            const text = ttsInput.value.trim();
            if (!text) {
                ttsStatus.textContent = "Please enter some text first.";
                ttsStatus.style.color = "var(--error-color)";
                return;
            }

            generateVoiceBtn.disabled = true;
            generateVoiceBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Generating...';
            ttsStatus.textContent = "Sending to Murf AI...";
            ttsStatus.style.color = "var(--text-muted)";
            ttsAudioContainer.style.display = 'none';

            try {
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text })
                });

                if (!response.ok) throw new Error(`Server returned ${response.status}`);
                const data = await response.json();

                if (data.audio_url) ttsAudioPlayer.src = data.audio_url;
                else if (data.audio_data) ttsAudioPlayer.src = `data:audio/mp3;base64,${data.audio_data}`;
                else throw new Error("No audio returned from server");

                ttsAudioContainer.style.display = 'flex';
                ttsAudioPlayer.play().catch(e => console.log("Autoplay prevented:", e));

                ttsStatus.textContent = "Audio generated successfully!";
                ttsStatus.style.color = "var(--primary)";

            } catch (error) {
                console.error("TTS Error:", error);
                ttsStatus.textContent = "Failed to generate audio. Check API keys.";
                ttsStatus.style.color = "var(--error-color)";
            } finally {
                generateVoiceBtn.disabled = false;
                generateVoiceBtn.innerHTML = '<i class="fa-solid fa-wave-square"></i> Generate Voice';
            }
        });
    }

    // ------------------------- 3. Voice Assistant Logic (Chat) -------------------------
    const micButton = document.getElementById('micButton');
    const statusIndicator = document.getElementById('statusIndicator');
    const chatArea = document.getElementById('chatArea');

    if (micButton && statusIndicator && chatArea) {

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            updateUIStatus(statusIndicator, "Speech recognition is not supported in this browser. Please use Chrome or Edge.", 'error');
            micButton.disabled = true;
        } else {
            const chatRecognition = new SpeechRecognition();
            chatRecognition.lang = "en-US";
            chatRecognition.continuous = false;
            chatRecognition.interimResults = false;

            let isSessionActive = false;

            chatRecognition.onstart = () => {
                micButton.classList.add('active');
                updateUIStatus(statusIndicator, 'Listening...', 'recording');
                // Ensure mic conflict is prevented (AI audio should be paused if starting early manually)
                if (!audioPlayer.paused) {
                    audioPlayer.pause();
                }
            };

            chatRecognition.onresult = async (event) => {
                const transcript = event.results[0][0].transcript;
                addMessageToArea(chatArea, transcript, 'user');
                updateUIStatus(statusIndicator, 'Thinking...', 'processing');

                // Send text instead of audio
                await sendChatTextToBackend(transcript);
            };

            chatRecognition.onerror = (event) => {
                console.error("Assistant recognition error:", event.error);
                micButton.classList.remove('active');
                if (event.error === 'not-allowed') {
                    isSessionActive = false;
                    updateUIStatus(statusIndicator, "Microphone access denied. Please allow microphone access in your browser settings.", 'error');
                } else if (event.error === 'no-speech') {
                    // If no speech detected but session is active, try to restart
                    if (isSessionActive && document.getElementById('assistant-tab').style.display !== 'none') {
                        try { chatRecognition.start(); } catch (err) {}
                    }
                } else {
                    updateUIStatus(statusIndicator, `Error: ${event.error}`, 'error');
                    if (isSessionActive) setTimeout(() => { try { chatRecognition.start(); } catch(e){} }, 2000);
                }
            };

            chatRecognition.onend = () => {
                micButton.classList.remove('active');
                // We do NOT auto-restart here except in explicit cases, to prevent conflicting with AI speaking.
                // Restarting happens in audioPlayer.onended or manual click.
                if (!isSessionActive) {
                    updateUIStatus(statusIndicator, 'Ready to chat');
                }
            };

            const toggleChatRecording = (e) => {
                e.preventDefault();
                if (!isSessionActive) {
                    // START SESSION
                    isSessionActive = true;
                    try {
                        chatRecognition.start();
                    } catch (err) {}
                } else {
                    // STOP SESSION
                    isSessionActive = false;
                    chatRecognition.stop();
                    audioPlayer.pause(); // Stop Murf audio
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel(); // Stop browser TTS just in case
                    updateUIStatus(statusIndicator, 'Session Stopped');
                }
            };

            micButton.addEventListener('click', toggleChatRecording);

            // Auto-resume listening when AI finishes speaking its audio response
            audioPlayer.onended = () => {
                if (isSessionActive && document.getElementById('assistant-tab').style.display !== 'none') {
                    try {
                        chatRecognition.start();
                    } catch(err) {}
                }
            };

            async function sendChatTextToBackend(userText) {
                addChatTypingIndicator();

                try {
                    const response = await fetch('/api/chat/text', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: userText })
                    });

                    removeChatTypingIndicator();

                    if (!response.ok) throw new Error(`Server status: ${response.status}`);
                    const data = await response.json();

                    if (data.ai_text) addMessageToArea(chatArea, data.ai_text, 'system');

                    if (data.audio_url) {
                        audioPlayer.src = data.audio_url;
                        updateUIStatus(statusIndicator, 'Speaking...');
                        audioPlayer.play().catch(e => {
                            console.error("Audio play failed:", e);
                            if (isSessionActive) try { chatRecognition.start(); } catch(err){} // Fallback resume
                        });
                    } else if (data.audio_data) {
                        audioPlayer.src = `data:audio/mp3;base64,${data.audio_data}`;
                        updateUIStatus(statusIndicator, 'Speaking...');
                        audioPlayer.play().catch(e => {
                            console.error("Audio play failed:", e);
                            if (isSessionActive) try { chatRecognition.start(); } catch(err){} // Fallback resume
                        });
                    } else {
                        // AI responded but no audio generated from backend, use browser native TTS
                        if ('speechSynthesis' in window) {
                            updateUIStatus(statusIndicator, 'Speaking...');
                            const utterance = new SpeechSynthesisUtterance(data.ai_text);
                            utterance.onend = () => {
                                if (isSessionActive && document.getElementById('assistant-tab').style.display !== 'none') {
                                    try { chatRecognition.start(); } catch(err){}
                                }
                            };
                            window.speechSynthesis.speak(utterance);
                        } else {
                            if (isSessionActive) {
                                try { chatRecognition.start(); } catch(err){}
                            }
                        }
                    }

                } catch (error) {
                    console.error('Error sending chat text:', error);
                    removeChatTypingIndicator();
                    updateUIStatus(statusIndicator, 'Error connecting to Server', 'error');
                    if (isSessionActive) {
                        setTimeout(() => {
                            updateUIStatus(statusIndicator, 'Retrying...');
                            try { chatRecognition.start(); } catch (e) {}
                        }, 3000);
                    } else {
                        setTimeout(() => updateUIStatus(statusIndicator, 'Ready to chat'), 3000);
                    }
                }
            }
        }

        function addChatTypingIndicator() {
            addMessageToArea(chatArea, '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>', 'system', true);
        }

        function removeChatTypingIndicator() {
            removeTempMessage(chatArea);
        }
    }


    // ------------------------- Shared Helper UI Functions -------------------------
    function updateUIStatus(indicatorElement, text, type = '') {
        indicatorElement.textContent = text;
        indicatorElement.className = 'status-indicator';
        if (type) indicatorElement.classList.add(type);
    }

    function addMessageToArea(areaElement, contentHTML, sender, isTemp = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${sender}-message`;
        if (isTemp) msgDiv.classList.add('temp-message');

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'avatar';
        // Give regular STT a user icon, but system responses a robot icon
        avatarDiv.innerHTML = sender === 'system' ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        // Use innerHTML so we can inject typing dots or raw text
        if (contentHTML.includes('<div') || contentHTML.includes('<span')) {
            contentDiv.innerHTML = contentHTML;
        } else {
            const p = document.createElement('p');
            p.textContent = contentHTML;
            contentDiv.appendChild(p);
        }

        msgDiv.appendChild(avatarDiv);
        msgDiv.appendChild(contentDiv);

        areaElement.appendChild(msgDiv);

        // Auto-scroll to bottom of chat area
        areaElement.scrollTo({
            top: areaElement.scrollHeight,
            behavior: 'smooth'
        });
    }

    function removeTempMessage(areaElement) {
        const tempMsgs = areaElement.querySelectorAll('.temp-message');
        tempMsgs.forEach(msg => msg.remove());
    }


    // ========================= RESUME ANALYZER =========================

    const uploadZone       = document.getElementById('uploadZone');
    const resumeFileInput  = document.getElementById('resumeFileInput');
    const uploadFileName   = document.getElementById('uploadFileName');
    const resumeTextarea   = document.getElementById('resumeTextarea');
    const analyzeResumeBtn = document.getElementById('analyzeResumeBtn');
    const clearResumeBtn   = document.getElementById('clearResumeBtn');
    const resumeError      = document.getElementById('resumeError');
    const resumeResults    = document.getElementById('resumeResults');

    if (uploadZone && analyzeResumeBtn) {

        let uploadedFile = null;  // holds the File object if user uploaded

        // ── Helper: enable/disable Analyze button ──
        function updateAnalyzeBtn() {
            const hasText = resumeTextarea.value.trim().length > 0;
            const hasFile = uploadedFile !== null;
            analyzeResumeBtn.disabled = !(hasText || hasFile);
        }

        // ── Click upload zone → open file picker ──
        uploadZone.addEventListener('click', () => resumeFileInput.click());

        // ── File selected via picker ──
        resumeFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleFileSelected(file);
        });

        // ── Drag & Drop ──
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleFileSelected(file);
        });

        function handleFileSelected(file) {
            const ext = file.name.split('.').pop().toLowerCase();
            const allowed = ['pdf', 'docx', 'txt'];
            if (!allowed.includes(ext)) {
                showResumeError(`Unsupported file type: .${ext}. Please use PDF, DOCX, or TXT.`);
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                showResumeError('File exceeds 10MB limit.');
                return;
            }
            uploadedFile = file;
            uploadFileName.textContent = `📄 ${file.name}`;
            uploadZone.classList.add('has-file');
            hideResumeError();
            updateAnalyzeBtn();
        }

        // ── Textarea changes ──
        resumeTextarea.addEventListener('input', updateAnalyzeBtn);

        // ── Analyze button click ──
        analyzeResumeBtn.addEventListener('click', async () => {
            hideResumeError();
            resumeResults.style.display = 'none';

            analyzeResumeBtn.disabled = true;
            analyzeResumeBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Analyzing...';

            try {
                let resumeText = '';

                // 1. Extract text
                if (uploadedFile) {
                    const ext = uploadedFile.name.split('.').pop().toLowerCase();

                    if (ext === 'txt') {
                        // Read TXT client-side
                        resumeText = await readFileAsText(uploadedFile);
                    } else {
                        // Send PDF or DOCX to backend for extraction
                        const formData = new FormData();
                        formData.append('file', uploadedFile);
                        const uploadRes = await fetch('/api/resume-upload', {
                            method: 'POST',
                            body: formData
                        });
                        if (!uploadRes.ok) {
                            const err = await uploadRes.json();
                            throw new Error(err.detail || 'File upload failed.');
                        }
                        const uploadData = await uploadRes.json();
                        resumeText = uploadData.text || '';
                    }
                } else {
                    resumeText = resumeTextarea.value.trim();
                }

                if (!resumeText) {
                    throw new Error('No resume text found. Please upload a file or paste text.');
                }

                // 2. Send to analyze API
                const response = await fetch('/api/resume-analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ resumeText })
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || err.detail || 'Analysis failed.');
                }

                const data = await response.json();

                // 3. Render results
                renderResumeResults(data);

                // Show Clear button
                clearResumeBtn.style.display = 'block';

            } catch (err) {
                console.error('[Resume Analyzer]', err);
                showResumeError(err.message || 'Something went wrong. Please try again.');
            } finally {
                analyzeResumeBtn.disabled = false;
                analyzeResumeBtn.innerHTML = '<i class="fa-solid fa-wand-sparkles"></i> Analyze Resume';
                updateAnalyzeBtn();
            }
        });

        // ── Clear button ──
        clearResumeBtn.addEventListener('click', () => {
            uploadedFile = null;
            resumeFileInput.value = '';
            uploadFileName.textContent = '';
            uploadZone.classList.remove('has-file', 'dragover');
            resumeTextarea.value = '';
            resumeResults.style.display = 'none';
            clearResumeBtn.style.display = 'none';
            hideResumeError();
            updateAnalyzeBtn();
        });

        // ── Helpers ──
        function readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = () => reject(new Error('Failed to read file.'));
                reader.readAsText(file, 'utf-8');
            });
        }

        function showResumeError(msg) {
            resumeError.textContent = msg;
            resumeError.style.display = 'block';
        }

        function hideResumeError() {
            resumeError.style.display = 'none';
            resumeError.textContent = '';
        }

        function renderResumeResults(data) {
            // 1. Score
            const scoreValue   = document.getElementById('scoreValue');
            const scoreCircle  = document.getElementById('scoreCircle');
            const resumeSummary = document.getElementById('resumeSummary');

            const score = Math.min(10, Math.max(0, Number(data.score) || 0));
            scoreValue.textContent = score;
            resumeSummary.textContent = data.summary || '';

            // Color the circle based on score
            if (score >= 8) {
                scoreCircle.style.borderColor = '#22c55e';
                scoreCircle.style.boxShadow = '0 0 16px rgba(34,197,94,0.3)';
                scoreValue.style.color = '#22c55e';
            } else if (score >= 5) {
                scoreCircle.style.borderColor = '#f59e0b';
                scoreCircle.style.boxShadow = '0 0 16px rgba(245,158,11,0.3)';
                scoreValue.style.color = '#f59e0b';
            } else {
                scoreCircle.style.borderColor = '#ef4444';
                scoreCircle.style.boxShadow = '0 0 16px rgba(239,68,68,0.3)';
                scoreValue.style.color = '#ef4444';
            }

            // 2. Missing Skills
            const tagsContainer = document.getElementById('missingSkillsTags');
            tagsContainer.innerHTML = '';
            (data.missingSkills || []).forEach(skill => {
                const tag = document.createElement('span');
                tag.className = 'skill-tag';
                tag.textContent = skill;
                tagsContainer.appendChild(tag);
            });

            // 3. Weak Sections
            renderList('weakSectionsList', data.weakSections || []);

            // 4. Improvements
            renderList('improvementsList', data.improvements || []);

            // 5. ATS Tips
            renderList('atsTipsList', data.atsTips || []);

            // 6. Examples
            document.getElementById('exampleBefore').textContent = data.examples?.before || '';
            document.getElementById('exampleAfter').textContent  = data.examples?.after  || '';

            // Show results
            resumeResults.style.display = 'flex';

            // Scroll the resume section to show results
            const resumeSec = document.querySelector('.resume-section');
            if (resumeSec) {
                setTimeout(() => {
                    resumeSec.scrollTo({ top: resumeSec.scrollHeight, behavior: 'smooth' });
                }, 100);
            }
        }

        function renderList(elementId, items) {
            const ul = document.getElementById(elementId);
            ul.innerHTML = '';
            items.forEach(item => {
                const li = document.createElement('li');
                li.textContent = item;
                ul.appendChild(li);
            });
        }
    }

});
