import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/contributor-assignment.yml', import.meta.url), 'utf8')
const script = workflow.match(/node <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
const checkboxStatement = script.match(/const checkboxStatement =\s*'([^']+)'/)[1]
const commentStatement = script.match(/const commentStatement =\s*'([^']+)'/)[1]
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function verify({ author = 'external-contributor', authorId = 42, authorType = 'User', body = '', comments = [], owner = 'parsij', extraPr = {} } = {}) {
    const statuses = []
    const paths = []
    const exit = Symbol('exit')
    let exitCode = 0
    const process = {
        env: { GH_TOKEN: 'test-placeholder', GITHUB_API_URL: 'https://api.example', REPOSITORY: 'parsij/PistachioSwap', REPOSITORY_OWNER: owner, PR_NUMBER: '211' },
        exit: code => { exitCode = code; throw exit },
    }
    const fetch = async (url, options = {}) => {
        const path = new URL(url).pathname
        paths.push(path)
        let payload
        if (path.endsWith('/pulls/211')) payload = { ...extraPr, user: { login: author, id: authorId, type: authorType }, body, head: { sha: 'test-head-sha' } }
        else if (path.endsWith('/comments')) payload = comments
        else if (path.endsWith('/statuses/test-head-sha')) {
            statuses.push(JSON.parse(options.body))
            payload = {}
        } else throw new Error('Unexpected API request')
        return { ok: true, status: 200, json: async () => payload }
    }
    try {
        await new AsyncFunction('process', 'fetch', 'console', script)(process, fetch, { log() {}, error() {} })
    } catch (error) {
        if (error !== exit) throw error
    }
    return { exitCode, statuses, paths }
}

function acceptance(login = 'external-contributor', id = 42, type = 'User', body = commentStatement) {
    return { user: { login, id, type }, body, html_url: 'https://github.example/comment', created_at: '2026-10-07T00:00:00Z' }
}

test('repository owner succeeds as NOT REQUIRED without signing or reading comments', async () => {
    const result = await verify({ author: 'parsij' })
    assert.equal(result.exitCode, 0)
    assert.equal(result.statuses[0].state, 'success')
    assert.match(result.statuses[0].description, /not required for repository owner/)
    assert.ok(!result.paths.some(path => path.endsWith('/comments')))
    assert.equal(result.statuses[0].context, 'CAA v1.2 / PR-author acceptance')
})

test('owner-created Codex PR succeeds based on identity only', async () => {
    const result = await verify({ author: 'parsij', extraPr: { title: 'Codex provider fixes' } })
    assert.equal(result.statuses[0].state, 'success')
})

test('owner is supplied by trusted context, not hardcoded or case-normalized', async () => {
    assert.equal((await verify({ owner: 'another-owner', author: 'another-owner' })).statuses[0].state, 'success')
    assert.equal((await verify({ owner: 'parsij', author: 'Parsij' })).statuses[0].state, 'failure')
})

test('external contributor without acceptance fails', async () => {
    const result = await verify()
    assert.equal(result.exitCode, 1)
    assert.equal(result.statuses[0].state, 'failure')
})

test('external contributor with both exact acceptance steps succeeds', async () => {
    const result = await verify({ body: `- [x] ${checkboxStatement}`, comments: [acceptance()] })
    assert.equal(result.exitCode, 0)
    assert.equal(result.statuses[0].state, 'success')
    assert.match(result.statuses[0].description, /accepted by PR author/)
})

test('checkbox alone and author comment alone are insufficient', async () => {
    assert.equal((await verify({ body: `- [x] ${checkboxStatement}` })).exitCode, 1)
    assert.equal((await verify({ comments: [acceptance()] })).exitCode, 1)
})

test('maintainer or repository owner cannot sign for an external contributor', async () => {
    for (const login of ['maintainer', 'parsij']) {
        const result = await verify({ body: `- [x] ${checkboxStatement}`, comments: [acceptance(login, 99)] })
        assert.equal(result.exitCode, 1)
    }
})

test('matching only login or only numeric ID does not prove author acceptance', async () => {
    for (const comment of [acceptance('external-contributor', 99), acceptance('other-user', 42)]) {
        assert.equal((await verify({ body: `- [x] ${checkboxStatement}`, comments: [comment] })).exitCode, 1)
    }
})

test('unrelated bots have no automatic exemption and cannot sign as a human', async () => {
    assert.equal((await verify({ author: 'unrelated[bot]', authorType: 'Bot' })).exitCode, 1)
    assert.equal((await verify({ author: 'unrelated[bot]', authorType: 'Bot', body: `- [x] ${checkboxStatement}`, comments: [acceptance('unrelated[bot]', 42, 'Bot')] })).exitCode, 1)
})

test('Codex labels in forgeable PR metadata cannot exempt external contributors', async () => {
    const result = await verify({ body: 'Internal owner Codex work', extraPr: { title: 'Codex owner work', head: { ref: 'codex-owner-fix' } } })
    assert.equal(result.exitCode, 1)
})

test('changed or deleted acceptance and altered checkbox statement fail', async () => {
    assert.equal((await verify({ body: `- [x] ${checkboxStatement}`, comments: [acceptance('external-contributor', 42, 'User', commentStatement + ' changed')] })).exitCode, 1)
    assert.equal((await verify({ body: `- [x] ${checkboxStatement.slice(0, -10)}`, comments: [acceptance()] })).exitCode, 1)
})

test('missing trusted owner context and invalid author ID fail closed', async () => {
    await assert.rejects(verify({ owner: '' }), /Missing GitHub event context/)
    await assert.rejects(verify({ author: 'parsij', authorId: '42' }), /Could not identify/)
})

test('privileged workflow uses trusted owner context without PR checkout', () => {
    assert.match(workflow, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/)
    assert.match(workflow, /pull_request_target:/)
    assert.match(workflow, /issue_comment:/)
    assert.doesNotMatch(workflow, /actions\/checkout|pull_request\.head\.ref/)
})
