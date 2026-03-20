from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import openai
import requests
import os
import aiofiles
import uuid
import json
import io
from groq import Groq

# PDF / DOCX text extraction
try:
    from pdfminer.high_level import extract_text as pdf_extract_text
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False

try:
    from docx import Document as DocxDocument
    DOCX_SUPPORT = True
except ImportError:
    DOCX_SUPPORT = False

# Import the MASTER_PROMPT from the user's file
from a import MASTER_PROMPT
from openai import OpenAI

# Load environment variables
load_dotenv()

# Initialize API Keys
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MURF_API_KEY = os.getenv("MURF_API_KEY")
MURF_VOICE_ID = os.getenv("MURF_VOICE_ID", "en-US-natalie")

if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY is missing in .env file. The AI chat will not work.")

# Initialize Groq Client (Free AI)
client = Groq(api_key=GROQ_API_KEY)

app = FastAPI()

# Create necessary directories
os.makedirs("static", exist_ok=True)
os.makedirs("uploads", exist_ok=True)
os.makedirs("downloads", exist_ok=True)

# Mount static files for the frontend
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve the index.html (Landing Page)
@app.get("/")
async def root():
    return FileResponse("index.html")

# Serve the tools.html (Voice Tools Page)
@app.get("/tools")
async def tools_page():
    return FileResponse("tools.html")

# Maintain conversation history in memory (for a single user simplified version)
# In a real app, you would use session IDs and a database.
conversation_history = [
    {"role": "system", "content": MASTER_PROMPT}
]

# Add a model for the TTS request body
class TTSRequest(BaseModel):
    text: str

@app.post("/api/chat")
async def chat_endpoint(audio: UploadFile = File(...)):
    """
    1. Receive Audio
    2. Transcribe Audio (Whisper)
    3. Generate Text Response (LLM)
    4. Generate Audio Response (Murf)
    5. Return Response Data
    """
    
    # --- 1. Save and Transcribe Audio ---
    audio_path = f"uploads/{uuid.uuid4()}_{audio.filename}"
    try:
        async with aiofiles.open(audio_path, 'wb') as out_file:
            content = await audio.read()
            await out_file.write(content)
            
        # Transcribe with OpenAI Whisper
        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1", 
                file=audio_file
            )
        user_text = transcription.text
        print(f"User Said: {user_text}")
        
    except Exception as e:
        print(f"Error during transcription: {e}")
        return JSONResponse(status_code=500, content={"error": "Failed to transcribe audio."})
    finally:
        # Cleanup uploaded file
        if os.path.exists(audio_path):
            os.remove(audio_path)

    # --- 2. Generate LLM Response (Groq - Free) ---
    try:
        # Add user message to history
        conversation_history.append({"role": "user", "content": user_text})
        
        # Call Groq ChatCompletion
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=conversation_history,
            max_tokens=150,
            temperature=0.7
        )
        
        ai_response_text = response.choices[0].message.content
        print(f"AI Responded: {ai_response_text}")
        
        # Add AI response to history
        conversation_history.append({"role": "assistant", "content": ai_response_text})
        
    except Exception as e:
        print(f"Error during LLM generation: {e}")
        return JSONResponse(status_code=500, content={"error": "Failed to generate AI response."})

    # --- 3. Generate Audio Response (Murf AI - Optional) ---
    try:
        if MURF_API_KEY and MURF_API_KEY != "your_murf_api_key_here":
            url = "https://api.murf.ai/v1/speech/generate" 
            headers = {
                "api-key": MURF_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            payload = {
                "voiceId": MURF_VOICE_ID,
                "style": "Conversational",
                "text": ai_response_text,
                "format": "MP3",
                "sampleRate": 24000
            }
            
            murf_response = requests.post(url, json=payload, headers=headers, timeout=5)
            if murf_response.status_code == 200:
                audio_url = murf_response.json().get("audioFile")
                return JSONResponse(content={
                    "user_text": user_text,
                    "ai_text": ai_response_text,
                    "audio_url": audio_url
                })
        
        # Fallback to text-only if Murf is disabled or fails
        return JSONResponse(content={
            "user_text": user_text,
            "ai_text": ai_response_text,
            "audio_url": None
        })
        
    except Exception as e:
        print(f"Murf API skipped due to error: {e}")
        return JSONResponse(content={
            "user_text": user_text,
            "ai_text": ai_response_text,
            "audio_url": None
        })

# Add a model for the chat text request body
class ChatTextRequest(BaseModel):
    text: str

@app.post("/api/chat/text")
async def chat_text_endpoint(request: ChatTextRequest):
    """
    Endpoint for Voice Assistant when using Web Speech API.
    1. Receive Text
    2. Generate LLM Response
    3. Generate Audio Response (Murf)
    """
    user_text = request.text
    print(f"User Said (Web Speech): {user_text}")

    # --- 1. Generate LLM Response (Groq - Free) ---
    try:
        conversation_history.append({"role": "user", "content": user_text})
        
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=conversation_history,
            max_tokens=150,
            temperature=0.7
        )
        
        ai_response_text = response.choices[0].message.content
        print(f"AI Responded: {ai_response_text}")
        
        conversation_history.append({"role": "assistant", "content": ai_response_text})
        
    except Exception as e:
        print(f"Error during LLM generation: {e}")
        return JSONResponse(status_code=500, content={"error": "Failed to generate AI response."})

    # --- 2. Generate Audio Response (Murf AI - Optional) ---
    try:
        if MURF_API_KEY and MURF_API_KEY != "your_murf_api_key_here":
            url = "https://api.murf.ai/v1/speech/generate" 
            headers = {
                "api-key": MURF_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            payload = {
                "voiceId": MURF_VOICE_ID,
                "style": "Conversational",
                "text": ai_response_text,
                "format": "MP3",
                "sampleRate": 24000
            }
            
            murf_response = requests.post(url, json=payload, headers=headers, timeout=5)
            if murf_response.status_code == 200:
                audio_url = murf_response.json().get("audioFile")
                return JSONResponse(content={
                    "user_text": user_text,
                    "ai_text": ai_response_text,
                    "audio_url": audio_url
                })
        
        # Fallback to text-only if Murf is disabled or fails
        return JSONResponse(content={
            "user_text": user_text,
            "ai_text": ai_response_text,
            "audio_url": None
        })
        
    except Exception as e:
        print(f"Murf API skipped due to error: {e}")
        return JSONResponse(content={
            "user_text": user_text,
            "ai_text": ai_response_text,
            "audio_url": None
        })

# Simple /chat endpoint
class ChatRequest(BaseModel):
    message: str

@app.post("/chat")
async def chat_simple_endpoint(request: ChatRequest):
    """Simple chat: { message } → { text }"""
    user_text = request.message
    print(f"[/chat] User: {user_text}")
    try:
        conversation_history.append({"role": "user", "content": user_text})
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=conversation_history,
            max_tokens=150,
            temperature=0.7
        )
        ai_response_text = response.choices[0].message.content
        print(f"[/chat] AI: {ai_response_text}")
        conversation_history.append({"role": "assistant", "content": ai_response_text})
        return JSONResponse(content={"text": ai_response_text})
    except Exception as e:
        print(f"[/chat] Error: {e}")
        return JSONResponse(content={"text": "Let's begin your interview. Can you tell me about yourself?"})
    except Exception as e:
        print(f"[/chat] Error: {e}")
        return JSONResponse(content={"text": "Let's begin your interview. Can you tell me about yourself?"})


@app.post("/api/tts")
async def tts_endpoint(request: TTSRequest):
    """
    Endpoint for the Text-to-Speech tool.
    Receives text, sends to Murf API, returns audio URL/data.
    """
    # --- Generate Audio Response (Murf AI - Optional) ---
    try:
        if MURF_API_KEY and MURF_API_KEY != "your_murf_api_key_here":
            url = "https://api.murf.ai/v1/speech/generate" 
            headers = {
                "api-key": MURF_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
            payload = {
                "voiceId": MURF_VOICE_ID,
                "style": "Conversational",
                "text": request.text,
                "format": "MP3",
                "sampleRate": 24000
            }
            
            murf_response = requests.post(url, json=payload, headers=headers, timeout=5)
            if murf_response.status_code == 200:
                audio_url = murf_response.json().get("audioFile")
                return JSONResponse(content={
                    "audio_url": audio_url,
                    "message": "TTS generated successfully"
                })
        
        # Fallback to text-only if Murf is disabled or fails
        return JSONResponse(content={
            "audio_url": None,
            "message": "Falling back to browser-native voice"
        })

    except Exception as e:
        print(f"TTS generation skipped due to error: {e}")
        return JSONResponse(content={
            "audio_url": None,
            "message": "Falling back to browser-native voice"
        })


@app.post("/api/stt")
async def stt_endpoint(audio: UploadFile = File(...)):
    """
    Endpoint for pure Speech-to-Text.
    """
    audio_path = f"uploads/{uuid.uuid4()}_{audio.filename}"
    try:
        content = await audio.read()
        print(f"Received audio file: {audio.filename}, Size: {len(content)} bytes")
        
        if len(content) < 100:
            print("Error: Audio file is too small.")
            return JSONResponse(status_code=400, content={"error": "Audio recording was too short. Please try again."})

        async with aiofiles.open(audio_path, 'wb') as out_file:
            await out_file.write(content)
            
        with open(audio_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1", 
                file=audio_file
            )
        return JSONResponse(content={"text": transcription.text})
    except Exception as e:
        error_msg = f"STT Error: {type(e).__name__}: {e}"
        print(error_msg)
        with open("stt_errors.log", "a") as f:
            f.write(f"{error_msg}\n")
        return JSONResponse(status_code=500, content={"error": f"Transcription failed: {str(e)}"})
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)


# ─────────────────────────────────────────────────────────────
# RESUME ANALYZER
# ─────────────────────────────────────────────────────────────

class ResumeAnalyzeRequest(BaseModel):
    resumeText: str


RESUME_SYSTEM_PROMPT = """You are an expert technical resume reviewer with 10+ years of hiring experience.
Analyze the provided resume text and return ONLY a valid JSON object.

STRICT RULES:
1. Return ONLY the JSON object. No markdown (no ```json code blocks), no explanations, no "Notes", and no preamble.
2. Your response MUST start with '{' and end with '}'.
3. The JSON must follow this exact schema:
{
  "score": <integer 0-10>,
  "summary": "<one short sentence summarizing the resume quality>",
  "missingSkills": ["skill1", "skill2", ...],
  "weakSections": ["section description 1", "section description 2", ...],
  "improvements": ["actionable improvement 1", "actionable improvement 2", ...],
  "atsTips": ["ats tip 1", "ats tip 2", ...],
  "examples": {
    "before": "<a weak bullet point from the resume or a generic weak example>",
    "after": "<the improved, quantified version of that bullet point>"
  }
}

If you cannot analyze it for some reason, still return a JSON object with an "error" field.
"""


@app.post("/api/resume-analyze")
async def resume_analyze_endpoint(request: ResumeAnalyzeRequest):
    """
    Analyze resume text using Groq AI and return structured JSON feedback.
    """
    resume_text = request.resumeText.strip()
    if not resume_text:
        raise HTTPException(status_code=400, detail="Resume text cannot be empty.")
    if len(resume_text) > 15000:
        resume_text = resume_text[:15000]  # Trim to avoid token limits

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": RESUME_SYSTEM_PROMPT},
                {"role": "user", "content": f"Resume text:\n\n{resume_text}"}
            ],
            max_tokens=2000,
            temperature=0,  # Lower temperature for more stable JSON
        )
        raw = response.choices[0].message.content
        
        # Robust JSON extraction: Find the first { and last }
        start_idx = raw.find('{')
        end_idx = raw.rfind('}')
        
        if start_idx != -1 and end_idx != -1:
            json_str = raw[start_idx:end_idx+1]
        else:
            json_str = raw

        result = json.loads(json_str)
        return JSONResponse(content=result)
    except json.JSONDecodeError as e:
        print(f"[resume-analyze] JSON parse error: {e}")
        return JSONResponse(status_code=500, content={"error": "AI returned malformed JSON. Please try again."})
    except Exception as e:
        print(f"[resume-analyze] Error: {e}")
        return JSONResponse(status_code=500, content={"error": f"Analysis failed: {str(e)}"})


@app.post("/api/resume-upload")
async def resume_upload_endpoint(file: UploadFile = File(...)):
    """
    Accept PDF, DOCX, or TXT upload and return extracted plain text.
    """
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    content = await file.read()

    if len(content) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=400, detail="File exceeds 10MB limit.")

    extracted_text = ""

    try:
        if ext == "txt":
            extracted_text = content.decode("utf-8", errors="replace")

        elif ext == "pdf":
            if not PDF_SUPPORT:
                raise HTTPException(status_code=500, detail="PDF support not available on this server.")
            pdf_stream = io.BytesIO(content)
            extracted_text = pdf_extract_text(pdf_stream)

        elif ext == "docx":
            if not DOCX_SUPPORT:
                raise HTTPException(status_code=500, detail="DOCX support not available on this server.")
            docx_stream = io.BytesIO(content)
            doc = DocxDocument(docx_stream)
            extracted_text = "\n".join([para.text for para in doc.paragraphs])

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: .{ext}. Use PDF, DOCX, or TXT.")

    except HTTPException:
        raise
    except Exception as e:
        print(f"[resume-upload] Extraction error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text: {str(e)}")

    if not extracted_text or not extracted_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the file. The file may be image-based or corrupted.")

    return JSONResponse(content={"text": extracted_text.strip()})


if __name__ == "__main__":
    import uvicorn
    # Run over HTTP (reverted for debugging)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
