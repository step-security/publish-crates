import * as core from '@actions/core'
import {
    error,
    getBooleanInput,
    getInput,
    info,
    setFailed,
    setOutput,
    warning
} from '@actions/core'
import {ExecOptions, exec} from '@actions/exec'

import {checkPackages, findPackages, sortPackages} from './package'
import {awaitCrateVersion} from './crates'
import {githubHandle} from './github'
import {delay} from './utils'
import axios, {isAxiosError} from 'axios'
import * as fs from 'fs'

interface EnvVars {
    [name: string]: string
}

function getIntegerInput(name: string): number | undefined {
    const value = parseInt(getInput(name))
    return isNaN(value) ? undefined : value
}

async function validateSubscription(): Promise<void> {
    const eventPath = process.env.GITHUB_EVENT_PATH
    let repoPrivate: boolean | undefined

    if (eventPath && fs.existsSync(eventPath)) {
        const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
        repoPrivate = eventData?.repository?.private
    }

    const upstream = 'katyo/publish-crates'
    const action = process.env.GITHUB_ACTION_REPOSITORY
    const docsUrl =
        'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions'

    core.info('')
    core.info('[1;36mStepSecurity Maintained Action[0m')
    core.info(`Secure drop-in replacement for ${upstream}`)
    if (repoPrivate === false)
        core.info('[32m✓ Free for public repositories[0m')
    core.info(`[36mLearn more:[0m ${docsUrl}`)
    core.info('')

    if (repoPrivate === false) return

    const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com'
    const body: Record<string, string> = {action: action || ''}
    if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl
    try {
        await axios.post(
            `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
            body,
            {timeout: 3000}
        )
    } catch (err) {
        if (isAxiosError(err) && err.response?.status === 403) {
            core.error(
                `[1;31mThis action requires a StepSecurity subscription for private repositories.[0m`
            )
            core.error(`[31mLearn how to enable a subscription: ${docsUrl}[0m`)
            process.exit(1)
        }
        core.info('Timeout or API not reachable. Continuing to next step.')
    }
}

async function run(): Promise<void> {
    await validateSubscription()
    const token = getInput('token')
    const path = getInput('path')
    const args = getInput('args')
        .split(/[\n\s]+/)
        .filter(arg => arg.length > 0)
    const registry_token = getInput('registry-token')
    const dry_run = getBooleanInput('dry-run')
    const check_repo = getBooleanInput('check-repo')
    const publish_delay = getIntegerInput('publish-delay')
    const no_verify = getBooleanInput('no-verify')
    const pass_on_no_unpublished_changes = getBooleanInput(
        'ignore-unpublished-changes'
    )

    const env: EnvVars = {...(process.env as EnvVars)}
    if (registry_token) {
        env.CARGO_REGISTRY_TOKEN = registry_token
    }

    const github = githubHandle(token)

    const published: {name: string; version: string}[] = []

    try {
        info(`Searching cargo packages at '${path}'`)
        const packages = await findPackages(path)
        info(JSON.stringify(packages, null, '  '))
        const package_names = Object.keys(packages).join(', ')
        info(`Found packages: ${package_names}`)

        info(`Checking packages consistency`)
        let package_errors = await checkPackages(packages, github)

        for (const {message} of package_errors) {
            error(message)
        }

        if (!check_repo) {
            package_errors = package_errors.filter(
                ({kind}) => kind !== 'unable-to-get-commit-date'
            )
        }

        if (package_errors.length > 0) {
            const has_unpublished_changes_error = package_errors.find(
                ({kind}) => kind === 'has-unpublished-changes'
            )
            const has_other_errors =
                package_errors.filter(
                    ({kind}) => kind !== 'has-unpublished-changes'
                ).length > 0

            if (
                has_unpublished_changes_error &&
                pass_on_no_unpublished_changes &&
                !has_other_errors
            ) {
                info(has_unpublished_changes_error.message)
                return
            }

            const packages_with_errors = package_errors
                .map(({name}) => name)
                .filter((name, index, errors) => errors.indexOf(name) === index)

            throw new Error(
                `Found ${
                    packages_with_errors.length
                } packages with consistency errors: ${packages_with_errors.join(
                    ' '
                )}`
            )
        }

        let sorted_packages
        if (!no_verify) {
            info(`Sorting packages according to dependencies`)
            sorted_packages = sortPackages(packages)
        } else {
            sorted_packages = Object.keys(packages)
        }

        for (const package_name of sorted_packages) {
            const package_info = packages[package_name]
            if (!package_info.published) {
                const exec_args = ['publish', ...args]
                if (no_verify) {
                    exec_args.push('--no-verify')
                }
                const exec_opts: ExecOptions = {
                    cwd: package_info.path,
                    env
                }
                if (dry_run) {
                    const args_str = exec_args.join(' ')
                    warning(
                        `Skipping exec 'cargo ${args_str}' in '${package_info.path}' due to 'dry-run: true'`
                    )
                    warning(
                        `Skipping awaiting when '${package_name} ${package_info.version}' will be available due to 'dry-run: true'`
                    )
                } else {
                    info(`Publishing package '${package_name}'`)
                    await exec('cargo', exec_args, exec_opts)
                    await awaitCrateVersion(package_name, package_info.version)
                    if (typeof publish_delay == 'number') {
                        await delay(publish_delay)
                    }
                    await exec('cargo', ['update', '--dry-run'], exec_opts)
                    info(`Package '${package_name}' published successfully`)
                }
                published.push({
                    name: package_name,
                    version: package_info.version
                })
            }
        }
    } catch (err) {
        setFailed(`${err}`)
    }
    setOutput('published', published)
}

run()
