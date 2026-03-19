import requests
import json

url = 'http://localhost:8000/api/resume-analyze'
payload = {
    'resumeText': 'John Doe\nSoftware Engineer\n\nExperienced software engineer with 3 years of experience in web development.\n\nSkills: JavaScript, React\n\nExperience: Frontend Developer at ABC Corp (2021-2024)\n- Worked on UI components\n- Fixed bugs'
}
headers = {'Content-Type': 'application/json'}

try:
    print("Sending request...")
    response = requests.post(url, json=payload, headers=headers)
    print(f'Status Code: {response.status_code}')
    try:
        print(json.dumps(response.json(), indent=2))
    except Exception as e:
        print("Raw text:", response.text)
except Exception as e:
    print("Error:", e)
