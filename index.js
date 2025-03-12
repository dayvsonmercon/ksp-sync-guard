const core = require('@actions/core');
const { execSync } = require('child_process');
const github = require('@actions/github');

async function run() {
    try{
        const token = core.getInput('github-token');
        const kspRepo = core.getInput('ksp-repo');
        const topicsFilePath = core.getInput('topics-file-path');
        const octokit = github.getOctokit(token);

        console.log("Cheking changes in .local.env...");

        // Retrieve changes in .local.env
        const diffOutput = execSync('git diff HEAD^ HEAD -- .local.env', {encoding: 'utf8'});
        
        // Filter only changes in KAFKA_SCHEMA_REGISTRY_* variables
        const schemaChanges = diffOutput.
            split('\n').
            filter(line => line.startsWith('+') && line.includes('KAFKA_SCHEMA-REGISTRY_')).
            map(line => line.replace('+', '').trim());

        if( schemaChanges.length == 0){
            console.log("No schema version changes detected.");
            return;
        }

        console.log("Found changes in .local.env");
        console.log(schemaChanges);

        // Retrieve the application-topics.yml file from Kafka-segure-proxy
        console.log(` Fetching ${topicsFilePath} from ${kspRepo}`);
        const {data: fileContent} = await octokit.rest.repos.getContent({
            owner: kspRepo.split('/')[0],
            repo: kspRepo.split('/')[1],
            path: topicsFilePath,
            ref: 'dev'
        });


        // Decode the content of application-topics.yml
        const contentKsp = Buffer.from(fileContent.content, 'base64').toString('utf8');

        // Check if each schema is present in application-topics.yml
        let missingSchemas = [];
        schemaChanges.forEach(change => {
            const [key, value] = change.split('=');
            if (!contentKsp.includes(value)) {
                missingSchemas.push({ key, value}); 
            }
        });

        if (missingSchemas.length > 0) {
            console.log(" Schema versions not found in KSP!");
            const missingList = missingSchemas.map(s => ` - **${s.key}** should contain: \`${s.value}\``).join('\n');

            // Retrieve the PR number
            const prNumber = github.context.payload.pull_request.number;

            //  Add a comment in the PR
            await octokit.rest.issues.createComment({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                issue_number: prNumber,
                body: ` **Schema versions mismatch detected!**
The following schema versions were updated in \`.local.env\`, but were not found in \`application-topics.yml\` of **kafka-secure-proxy**
${missingList}

** Please update the corresponding values in kafka-secure-proxy. **`});
            core.setFailed("Schema versions not synced with kafka-secure-proxu");

        }else {
            console.log(" All schema versions are correctly synced");
        }

       
    } catch (error) {
        core.setFailed(` Error: ${error.message}`)
    }
}

run();