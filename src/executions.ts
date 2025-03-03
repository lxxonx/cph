import { Language, Run } from './types';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { platform } from 'os';
import config from './config';
import { getTimeOutPref } from './preferences';
import * as vscode from 'vscode';
import path from 'path';
import { onlineJudgeEnv } from './compiler';

const runningBinaries: ChildProcessWithoutNullStreams[] = [];

/**
 * Run a single testcase, and return the raw results, without judging.
 *
 * @param binPath path to the executable binary
 * @param input string to be piped into the stdin of the spawned process
 */
export const runTestCase = (
    language: Language,
    binPath: string,
    input: string,
): Promise<Run> => {
    console.log('Running testcase', language, binPath, input);
    const result: Run = {
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        time: 0,
        timeOut: false,
    };
    const spawnOpts = {
        timeout: config.timeout,
        env: {
            DEBUG: 'true',
            CPH: 'true',
            PATH: process.env.PATH,
        },
    };

    let testProcess: ChildProcessWithoutNullStreams;

    const killer = setTimeout(() => {
        result.timeOut = true;
        testProcess.kill();
    }, getTimeOutPref());

    // HACK - On Windows, `python3` will be changed to `python`!
    if (platform() === 'win32' && language.compiler === 'python3') {
        language.compiler = 'python';
    }

    // Start the binary or the interpreter.
    switch (language.name) {
        case 'python': {
            testProcess = spawn(
                language.compiler, // 'python3' or 'python' TBD
                [binPath, ...language.args],
                spawnOpts,
            );
            break;
        }
        case 'javascript': {
            testProcess = spawn(
                language.compiler,
                [binPath, ...language.args],
                spawnOpts,
            );
            break;
        }
        case 'java': {
            const args: string[] = [];
            if (onlineJudgeEnv) {
                args.push('-DONLINE_JUDGE');
            }

            const binDir = path.dirname(binPath);
            args.push('-cp');
            args.push(binDir);

            const binFileName = path.parse(binPath).name.slice(0, -1);
            args.push(binFileName);

            testProcess = spawn('java', args);
            break;
        }
        default: {
            testProcess = spawn(binPath, spawnOpts);
        }
    }

    testProcess.on('error', (err) => {
        console.error(err);
        vscode.window.showErrorMessage(
            `Could not launch testcase process. Is '${language.compiler}' in your PATH?`,
        );
    });

    const begin = Date.now();
    const ret: Promise<Run> = new Promise((resolve) => {
        runningBinaries.push(testProcess);
        testProcess.on('exit', (code, signal) => {
            const end = Date.now();
            clearTimeout(killer);
            result.code = code;
            result.signal = signal;
            result.time = end - begin;
            runningBinaries.pop();
            console.log('Run Result:', result);
            resolve(result);
        });

        testProcess.stdout.on('data', (data) => {
            result.stdout += data;
        });
        testProcess.stderr.on('data', (data) => (result.stderr += data));

        console.log('Wrote to STDIN');
        try {
            testProcess.stdin.write(input);
        } catch (err) {
            console.error('WRITEERROR', err);
        }

        testProcess.stdin.end();
        testProcess.on('error', (err) => {
            const end = Date.now();
            clearTimeout(killer);
            result.code = 1;
            result.signal = err.name;
            result.time = end - begin;
            runningBinaries.pop();
            console.log('Run Error Result:', result);
            resolve(result);
        });
    });

    return ret;
};

/** Remove the generated binary from the file system, if present */
export const deleteBinary = (language: Language, binPath: string) => {
    if (language.skipCompile) {
        console.log(
            "Skipping deletion of binary as it's not a compiled language.",
        );
        return;
    }
    console.log('Deleting binary', binPath);
    try {
        if (platform() == 'linux') {
            spawn('rm', [binPath]);
        } else {
            spawn('del', [binPath], { shell: true });
        }
    } catch (err) {
        console.error('Error while deleting binary', err);
    }
};

/** Kill all running binaries. Usually, only one should be running at a time. */
export const killRunning = () => {
    console.log('Killling binaries');
    runningBinaries.forEach((process) => process.kill());
};
