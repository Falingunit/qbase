import requests
import os
import json

headers = {
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2OTkxNzVmNjcwMTY3ODUwOTBiZGI0ZiIsImlhdCI6MTc2MDE4ODAyOCwiZXhwIjoxNzYyNzgwMDI4fQ.v7tZWhoru3bC6c4H8RjtaGdkHm4luZQWvQ1kivF1Jl0"
}

base_urls = {
    'dashboard': 'https://web.getmarks.app/api/v3/dashboard/platform/web',
    'exam_subjects': 'https://web.getmarks.app/api/v4/cpyqb/exam/`exam_id`',
    'subject_chapters': 'https://web.getmarks.app/api/v4/cpyqb/exam/`exam_id`/subject/`subject_id`',
    'chapter_icons': 'https://web.getmarks.app/icons/exam/`icon_name`',
    'questions': 'https://web.getmarks.app/api/v4/cpyqb/exam/`exam_id`/subject/`subject_id`/chapter/`chapter_id`/questions'
}

# -- Helper Functions ---
def make_request(url_id, url_params = {}, params = None):
    evaluated_url = evaluate_url(url_id, url_params)
    return requests.get(evaluated_url, headers=headers, params=params) # type: ignore
def evaluate_url(url_id, url_params):
    result = base_urls[url_id]
    for url_param in url_params.items():
        result = result.replace(f'`{url_param[0]}`', url_param[1])

    return result
def pretty_print(str):
    return json.dumps(str, indent = 2)
def write_to_file(content, filename):
    with open('./utils/scraper/output/' + filename, 'w') as f:
        f.write(content)
def get_element(list, item, value):
    for i in list:
        if i[item] == value:
            return i
def display_menu(lst):
    for i, item in enumerate(lst):
        print(f"{str(i + 1)}. {item}")

    opt = -1
    while opt - 1 not in range(len(lst)):
        opt = int(input(f"Choose an option (1 .. {len(lst)}): "))
    
    return opt - 1


# Requests
def get_all_exam_information():
    response = make_request('dashboard', params={'limit': 10000})
    response_json = response.json()

    exams_list = get_element(response_json['data']['items'], "componentTitle", "ChapterwiseExams")['items'] # type: ignore
    exams_list_clean = [{'name': exam['title'], 'id': exam['examId'], 'icon': exam['icon']['dark']} for exam in exams_list]

    return exams_list_clean
    write_to_file(pretty_print(exams_list_clean), 'dashboard_output_data.json')

def get_all_subjects(exam):
    response = make_request('exam_subjects', url_params={'exam_id': exam['id']}, params={'limit': 10000})
    response_json = response.json()

    subjects_list = response_json["data"]["subjects"]
    subjects_list_clean = [{'name': subject['title'], 'id': subject['_id'], 'icon': subject['icon']} for subject in subjects_list]

    return subjects_list_clean
    write_to_file(pretty_print(response_json), 'subject_info.json')

def get_all_chapters(exam, subject):
    response = make_request('subject_chapters', url_params={'exam_id': exam['id'], 'subject_id': subject['id']}, params={'limit': 10000})
    response_json = response.json()

    chapters_list = response_json["data"]["chapters"]["data"]
    chapters_list_clean = [{'name': chapter['title'], 'id': chapter['_id'], 'icon_name':chapter['icon'], 'total_questions': chapter['allPyqs']['totalQs']} for chapter in chapters_list]

    return chapters_list_clean
    write_to_file(pretty_print(response_json), 'chapter_info.json')

def get_all_questions(exam, subject, chapter):
    response = make_request('questions', url_params={'exam_id': exam['id'], 'subject_id': subject['id'], 'chapter_id': chapter['id']}, params={'limit': 10000, 'hideOutOfSyllabus': False})
    response_json = response.json()

    def correctOptions(questionOptions):
        result = []
        
        for option, optionText in zip(questionOptions, ['A', 'B', 'C', 'D']):
            if option['isCorrect']:
                result.append(optionText)

        return result

    questions_list = response_json["data"]["questions"]
    questions_list_clean = [{
        'type': question['type'], 
        'diffuculty': question['level'], 
        'pyqInfo': question['previousYearPapers'][0]['title'], 
        'qText': question['question']['text'], 
        'qImage': question['question']['image'], 
        'options': [{'oText': option['text'], 
                     'oImage': option['image']} for option in question['options']], 
                     'correctAnswer': correctOptions(question['options']) if not question['type'] == 'numerical' else question['correctValue'],
        'solution': {'sText': question['solution']['text'], 
                     'sImage': question['solution']['image']}
        } for question in questions_list]

    return questions_list_clean
    write_to_file(pretty_print(questions_list), 'questions_info.json')

downloaded_paths = []
def download_images(paths : list[str], subpath):
    os.makedirs(f"./utils/scraper/output/downloads/{subpath}/", exist_ok=True)
    for path in paths:
        if path in downloaded_paths:
            continue

        try:
            response = requests.get(path, stream=True)
            response.raise_for_status()

            filename = os.path.join(f"./utils/scraper/output/downloads/{subpath}/", path.split('/')[-1])

            with open(filename, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            downloaded_paths.append(path)
        except requests.exceptions.RequestException as e:
            print(f"Error downloading image: {e}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
        
if __name__ == "__main__":
    exams = get_all_exam_information()
    download_images([exam['icon'] for exam in exams], 'exams')
    examIndex = display_menu([exam['name'] for exam in exams])


    print()
    print(f"{exams[examIndex]['name']}: ")
    subjects = get_all_subjects(exams[examIndex])
    download_images([subject['icon'] for subject in subjects], 'subjects')
    subjectIndex = display_menu([subject['name'] for subject in subjects])
    
    print()
    print(f"{subjects[subjectIndex]['name']}: ")
    chapters = get_all_chapters(exams[examIndex], subjects[subjectIndex])
    download_images([evaluate_url('chapter_icons', {'icon_name': chapter['icon_name']}) for chapter in chapters], 'chapter_icons')
    chapterIndex = display_menu([chapter['name'] for chapter in chapters])
    
    questions = get_all_questions(exams[examIndex], subjects[subjectIndex], chapters[chapterIndex])

    write_to_file(pretty_print(questions), 'output.json')
    print("Outputted all questions...")
