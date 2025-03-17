document.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('username');
    const additionalInfoInput = document.getElementById('additional-info');
    const generateBtn = document.getElementById('generate-btn');
    const loadingElement = document.getElementById('loading');
    const resultElement = document.getElementById('result');
    const resumePreview = document.getElementById('resume-preview');
    const downloadPdfBtn = document.getElementById('download-pdf');
    const copyHtmlBtn = document.getElementById('copy-html');
    const regenerateBtn = document.getElementById('regenerate');
    const progressBar = document.getElementById('progress');
    const statusMessage = document.getElementById('status-message');

    generateBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim();
        if (!username) {
            alert('Please enter your WebSim username');
            return;
        }

        try {
            // Show loading and hide other sections
            loadingElement.classList.remove('hidden');
            resultElement.classList.add('hidden');
            generateBtn.disabled = true;

            // Reset progress
            updateProgress(0, 'Fetching user data...');

            // Fetch user data with retries
            const userData = await retryOperation(() => fetchUserData(username));
            if (!userData) {
                throw new Error('User not found');
            }
            
            updateProgress(10, 'Fetching projects...');

            // Fetch user's projects with retries
            const projects = await retryOperation(() => fetchUserProjects(username));
            if (!projects || projects.length === 0) {
                throw new Error('No projects found for this user');
            }
            
            updateProgress(30, `Found ${projects.length} projects. Ranking by engagement...`);

            // Rank projects by engagement metrics
            const rankedProjects = rankProjects(projects);
            
            updateProgress(50, 'Analyzing top projects...');

            // Take top 100 or all if less than 100
            const topProjects = rankedProjects.slice(0, 100);
            
            updateProgress(70, 'Generating resume with AI...');

            // Generate resume using LLM with retries
            const additionalInfo = additionalInfoInput.value.trim();
            const resumeContent = await retryOperation(() => 
                generateResume(userData, topProjects, additionalInfo));
            
            updateProgress(90, 'Preparing resume preview...');

            // Display the generated resume
            resumePreview.innerHTML = resumeContent;
            
            // Show result and hide loading
            loadingElement.classList.add('hidden');
            resultElement.classList.remove('hidden');
            generateBtn.disabled = false;
            
            updateProgress(100, 'Resume generated successfully!');
        } catch (error) {
            alert(`Error: ${error.message}`);
            loadingElement.classList.add('hidden');
            generateBtn.disabled = false;
        }
    });

    // PDF download handler
    downloadPdfBtn.addEventListener('click', () => {
        const element = resumePreview.cloneNode(true);
        const opt = {
            margin: [10, 10],
            filename: `websim-resume-${usernameInput.value}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        html2pdf().set(opt).from(element).save();
    });

    // Copy HTML handler
    copyHtmlBtn.addEventListener('click', () => {
        const htmlContent = resumePreview.innerHTML;
        navigator.clipboard.writeText(htmlContent)
            .then(() => alert('Resume HTML copied to clipboard!'))
            .catch(err => alert('Failed to copy: ' + err));
    });

    // Regenerate handler
    regenerateBtn.addEventListener('click', async () => {
        try {
            loadingElement.classList.remove('hidden');
            resultElement.classList.add('hidden');
            
            updateProgress(70, 'Regenerating resume with AI...');
            
            // Get the same data but generate a new resume
            const username = usernameInput.value.trim();
            const userData = await retryOperation(() => fetchUserData(username));
            const projects = await retryOperation(() => fetchUserProjects(username));
            const rankedProjects = rankProjects(projects);
            const topProjects = rankedProjects.slice(0, 100);
            const additionalInfo = additionalInfoInput.value.trim();
            
            // Add a regeneration flag to get a different style
            const resumeContent = await retryOperation(() => 
                generateResume(userData, topProjects, additionalInfo, true));
            
            resumePreview.innerHTML = resumeContent;
            
            loadingElement.classList.add('hidden');
            resultElement.classList.remove('hidden');
        } catch (error) {
            alert(`Regeneration Error: ${error.message}`);
            loadingElement.classList.add('hidden');
            resultElement.classList.remove('hidden');
        }
    });

    // Helper function to update progress bar
    function updateProgress(percent, message) {
        if (percent !== null) {
            progressBar.style.width = `${percent}%`;
        }
        statusMessage.textContent = message;
    }

    // Function to fetch user data
    async function fetchUserData(username) {
        const response = await fetch(`/api/v1/users/${username}`);
        if (!response.ok) {
            throw new Error('User not found');
        }
        const data = await response.json();
        return data.user;
    }

    // Function to fetch user projects
    async function fetchUserProjects(username) {
        // Set a large limit to get as many projects as possible
        const response = await fetch(`/api/v1/users/${username}/projects?first=100`);
        if (!response.ok) {
            throw new Error('Failed to fetch projects');
        }
        
        const data = await response.json();
        let allProjects = [...data.projects.data];
        
        // If there are more pages, fetch them
        let nextCursor = data.projects.meta.end_cursor;
        while (nextCursor && data.projects.meta.has_next_page) {
            updateProgress(30, `Fetching more projects... (${allProjects.length} so far)`);
            
            const nextResponse = await fetch(`/api/v1/users/${username}/projects?first=100&after=${nextCursor}`);
            if (!nextResponse.ok) break;
            
            const nextData = await nextResponse.json();
            allProjects = [...allProjects, ...nextData.projects.data];
            nextCursor = nextData.projects.meta.end_cursor;
            
            if (!nextData.projects.meta.has_next_page) break;
        }
        
        return allProjects;
    }

    // Function to rank projects by engagement metrics
    function rankProjects(projects) {
        return projects.sort((a, b) => {
            const aScore = calculateProjectScore(a);
            const bScore = calculateProjectScore(b);
            return bScore - aScore; // Sort in descending order
        });
    }

    // Calculate a score for each project based on engagement metrics
    function calculateProjectScore(projectData) {
        const project = projectData.project;
        const revision = projectData.project_revision;
        
        // Calculate score based on likes, comments, and version (number of revisions)
        const likeScore = project.stats.likes * 3;
        const commentScore = project.stats.comments * 5;
        const versionScore = revision && revision.version ? revision.version * 2 : 0;
        
        // Bonus points for projects that have been posted
        const postedBonus = project.posted ? 10 : 0;
        
        // Total score
        return likeScore + commentScore + versionScore + postedBonus;
    }

    // Function to generate resume using LLM
    async function generateResume(userData, projects, additionalInfo, isRegeneration = false) {
        try {
            // Prepare project data for the LLM
            const projectsData = projects.map(p => {
                const project = p.project;
                const revision = p.project_revision;
                return {
                    title: project.title || 'Untitled Project',
                    description: project.description || '',
                    likes: project.stats.likes,
                    comments: project.stats.comments,
                    version: revision.version,
                    created_at: project.created_at,
                    updated_at: project.updated_at,
                    posted: project.posted,
                    url: `https://websim.ai/p/${project.id}`
                };
            });

            // Create a prompt for the LLM
            const prompt = `Create a professional resume for a web developer based on their WebSim project data. 
            
User information:
Username: ${userData.username}
Bio: ${userData.description || 'No bio provided'}

Additional information provided by user:
${additionalInfo || 'None provided'}

Top ${projectsData.length} projects (ranked by engagement):
${JSON.stringify(projectsData.slice(0, 10))}
...and ${projectsData.length - 10} more projects

${isRegeneration ? 'Please generate a completely different style of resume than before, with a different structure and focus.' : ''}

Instructions:
1. Create a professional-looking resume in HTML format
2. Use the class 'resume' for the main container
3. Highlight the most impressive projects and group similar projects together
4. Extract skills based on project descriptions and titles
5. Include sections for: Summary, Skills, Notable Projects, and Experience
6. Include any additional information provided by the user
7. Make it look professional and ready for job applications
8. Only output the HTML for the resume, no explanations or markdown`;

            // Generate resume using LLM
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are an expert resume writer who specializes in creating compelling web developer resumes based on project work. Create a professional HTML resume with sections for a summary, skills, and notable projects."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            });

            return completion.content;
        } catch (error) {
            console.error('Error generating resume with LLM:', error);
            throw new Error('Failed to generate resume');
        }
    }

    // Add a generic retry function for any operation
    async function retryOperation(operation) {
        let retries = 0;
        const maxRetries = 3;
        
        while (retries < maxRetries) {
            try {
                return await operation();
            } catch (error) {
                retries++;
                console.error(`Operation failed (attempt ${retries}/${maxRetries}):`, error);
                
                if (retries >= maxRetries) {
                    console.warn('Maximum retries reached, continuing with process');
                    // Return a fallback value or throw depending on context
                    return error.fallbackValue || [];
                }
                
                // Show retry message in progress
                updateProgress(null, `Retry attempt ${retries}/${maxRetries}...`);
                
                // Wait a second before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
});