import System from 'system';

let failures = 0;
let checks = 0;

export function print(text) {
    globalThis.print(text);
}

export function check(name, actual, expected) {
    checks++;
    let a = JSON.stringify(actual);
    let e = JSON.stringify(expected);
    if (a === e) {
        print(`  ok   ${name}`);
    } else {
        failures++;
        print(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
    }
}

export function checkThrows(name, fn, fragment) {
    checks++;
    try {
        fn();
        failures++;
        print(`  FAIL ${name}\n         expected a thrown error containing "${fragment}"`);
    } catch (e) {
        if (e.message.includes(fragment)) {
            print(`  ok   ${name}`);
        } else {
            failures++;
            print(`  FAIL ${name}\n         expected message containing "${fragment}"\n         actual   "${e.message}"`);
        }
    }
}

export function finish() {
    print('');
    if (failures > 0) {
        print(`${failures} of ${checks} checks failed`);
        System.exit(1);
    }
    print(`all ${checks} checks passed`);
}

export const helpers = {check, checkThrows, print};
