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
        // Create a clone to avoid modifying the visible DOM
        const element = resumePreview.cloneNode(true);
        
        // Add print-specific styling
        const style = document.createElement('style');
        style.textContent = `
            @page {
                margin: 15mm 10mm;
                size: A4;
            }
            body {
                font-family: 'Georgia', serif;
                font-size: 12pt;
                line-height: 1.5;
                color: #333;
            }
            .resume {
                max-width: 100%;
                padding: 0;
                margin: 0;
            }
            .project-item, .experience-item, .education-item {
                page-break-inside: avoid;
            }
            a {
                text-decoration: none;
                color: #333;
            }
            .project-stats, .contact-info {
                display: flex;
                gap: 10px;
            }
        `;
        element.appendChild(style);
        
        const opt = {
            margin: [10, 10],
            filename: `websim-resume-${usernameInput.value}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        // Show a message to let the user know PDF is being generated
        statusMessage.textContent = 'Generating PDF, please wait...';
        
        html2pdf().set(opt).from(element).save().then(() => {
            statusMessage.textContent = 'PDF downloaded successfully!';
            setTimeout(() => {
                statusMessage.textContent = '';
            }, 3000);
        });
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
        // Check if user data is in localStorage
        const cachedUserData = localStorage.getItem(`userData_${username}`);
        if (cachedUserData) {
            return JSON.parse(cachedUserData);
        }

        const response = await fetch(`/api/v1/users/${username}`);
        if (!response.ok) {
            throw new Error('User not found');
        }
        const data = await response.json();
        
        // Cache the user data
        localStorage.setItem(`userData_${username}`, JSON.stringify(data.user));
        return data.user;
    }

    // Function to fetch user projects
    async function fetchUserProjects(username) {
        // Check if we have cached projects
        const cachedProjectsKey = `projects_${username}`;
        const cachedProjects = localStorage.getItem(cachedProjectsKey);
        let allProjects = [];
        let nextCursor = null;
        
        if (cachedProjects) {
            const parsedCache = JSON.parse(cachedProjects);
            allProjects = parsedCache.projects;
            nextCursor = parsedCache.nextCursor;
            
            // If we have complete data, return it
            if (!parsedCache.hasNextPage) {
                return allProjects;
            }
            
            updateProgress(30, `Found ${allProjects.length} cached projects. Fetching more...`);
        } else {
            // Set a large limit to get as many projects as possible
            const response = await fetch(`/api/v1/users/${username}/projects?first=100`);
            if (!response.ok) {
                throw new Error('Failed to fetch projects');
            }
            
            const data = await response.json();
            allProjects = [...data.projects.data];
            
            // Save next cursor for pagination
            nextCursor = data.projects.meta.end_cursor;
            
            // Cache partial results
            localStorage.setItem(cachedProjectsKey, JSON.stringify({
                projects: allProjects,
                nextCursor: nextCursor,
                hasNextPage: data.projects.meta.has_next_page
            }));
            
            if (!data.projects.meta.has_next_page) {
                return allProjects;
            }
        }
        
        // If there are more pages, fetch them starting from the last cursor
        let hasNextPage = true;
        let paginationCount = 0;
        const MAX_PAGES = 10; // Limit to 10 pages (1000 records with 100 per page)
        
        while (nextCursor && hasNextPage && paginationCount < MAX_PAGES) {
            updateProgress(30, `Fetching more projects... (${allProjects.length} so far)`);
            paginationCount++;
            
            const nextResponse = await fetch(`/api/v1/users/${username}/projects?first=100&after=${nextCursor}`);
            if (!nextResponse.ok) break;
            
            const nextData = await nextResponse.json();
            allProjects = [...allProjects, ...nextData.projects.data];
            nextCursor = nextData.projects.meta.end_cursor;
            hasNextPage = nextData.projects.meta.has_next_page;
            
            // Update cache with new data
            localStorage.setItem(cachedProjectsKey, JSON.stringify({
                projects: allProjects,
                nextCursor: nextCursor,
                hasNextPage: hasNextPage && paginationCount < MAX_PAGES
            }));
            
            if (!hasNextPage) break;
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
                    version: revision ? revision.version : 1,
                    created_at: project.created_at,
                    updated_at: project.updated_at,
                    posted: project.posted,
                    url: `https://websim.ai/p/${project.id}`
                };
            });

            // Extract additional information
            const additionalInfoParsed = parseAdditionalInfo(additionalInfo);

            // Create a prompt for the LLM
            const prompt = `Create a detailed, professional resume for a web developer based on their WebSim project data. 
            
User information:
Username: ${userData.username}
Bio: ${userData.description || 'No bio provided'}

Additional information:
${JSON.stringify(additionalInfoParsed)}

Top ${projectsData.length} projects (ranked by engagement):
${JSON.stringify(projectsData.slice(0, 15))}
...and ${Math.max(0, projectsData.length - 15)} more projects

${isRegeneration ? 'Please generate a completely different style of resume than before, with a different structure and focus.' : ''}

Instructions:
1. Create a professional-looking resume in HTML format with the class 'resume' for the main container
2. Include a detailed header with the user's name and contact information from the additional info
3. Create a professional summary that highlights the developer's expertise based on their projects
4. Extract and categorize skills (like languages, frameworks, tools) from project descriptions and titles
5. Include sections for: Summary, Skills, Notable Projects, Experience (from additional info), and Education (from additional info)
6. For each project, include: title (linked to URL), description, technologies used, and metrics (likes, comments)
7. Format dates in a professional manner (Month Year)
8. Add appropriate icons using inline SVG for contact info and metrics
9. Make the resume both visually appealing and structured for easy scanning by recruiters
10. Ensure the layout works well for both screen viewing and PDF printing
11. Only output the complete HTML for the resume without any explanations`;

            // Generate resume using LLM
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are an expert resume writer who specializes in creating compelling web developer resumes based on project work. Create a professional HTML resume with detailed sections for a summary, skills, notable projects, experience, and education. Include inline SVG icons for better visuals."
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

    // Parse additional information into structured data
    function parseAdditionalInfo(additionalInfo) {
        if (!additionalInfo) return { skills: [], experience: [], education: [] };
        
        const result = {
            skills: [],
            experience: [],
            education: [],
            contact: {}
        };
        
        // Try to extract skills (usually comma separated or bullet points)
        const skillsMatch = additionalInfo.match(/skills:?\s*([\s\S]*?)(?:\n\n|\n(?=[A-Za-z]+:)|$)/i);
        if (skillsMatch) {
            result.skills = skillsMatch[1]
                .split(/,|\n|•/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
        }
        
        // Try to extract experience
        const experienceMatch = additionalInfo.match(/experience:?\s*([\s\S]*?)(?:\n\n|\n(?=[A-Za-z]+:)|$)/i);
        if (experienceMatch) {
            result.experience = parseStructuredSection(experienceMatch[1]);
        }
        
        // Try to extract education
        const educationMatch = additionalInfo.match(/education:?\s*([\s\S]*?)(?:\n\n|\n(?=[A-Za-z]+:)|$)/i);
        if (educationMatch) {
            result.education = parseStructuredSection(educationMatch[1]);
        }
        
        // Try to extract contact information
        const emailMatch = additionalInfo.match(/email:?\s*([^\n]+)/i);
        if (emailMatch) result.contact.email = emailMatch[1].trim();
        
        const phoneMatch = additionalInfo.match(/phone:?\s*([^\n]+)/i);
        if (phoneMatch) result.contact.phone = phoneMatch[1].trim();
        
        const locationMatch = additionalInfo.match(/location:?\s*([^\n]+)/i);
        if (locationMatch) result.contact.location = locationMatch[1].trim();
        
        const linkedinMatch = additionalInfo.match(/linkedin:?\s*([^\n]+)/i);
        if (linkedinMatch) result.contact.linkedin = linkedinMatch[1].trim();
        
        const websiteMatch = additionalInfo.match(/website:?\s*([^\n]+)/i);
        if (websiteMatch) result.contact.website = websiteMatch[1].trim();
        
        return result;
    }
    
    function parseStructuredSection(text) {
        // Split by double newlines or patterns that look like they start a new entry
        const entries = text.split(/\n\n|\n(?=\d{4}|\d{1,2}\/\d{1,2}|\w+\s+\d{4}|[A-Z][a-z]+\s+\d{4})/);
        
        return entries
            .map(entry => entry.trim())
            .filter(entry => entry.length > 0);
    }

    // Add a generic retry function for any operation that maintains state between retries
    async function retryOperation(operation) {
        let retries = 0;
        let delay = 1000; // Start with 1 second delay
        let lastError = null;
        
        while (true) {
            try {
                if (retries > 0) {
                    updateProgress(null, `Retry attempt ${retries}... (waiting ${delay/1000}s)`);
                    // Wait before retrying with increasing delay
                    await new Promise(resolve => setTimeout(resolve, delay));
                    // Increase delay for next retry
                    delay += 1000;
                }
                return await operation();
            } catch (error) {
                retries++;
                lastError = error;
                console.error(`Operation failed (attempt ${retries}):`, error);
            }
        }
    }
});