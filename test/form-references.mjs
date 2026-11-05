import {isAbsolute, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const configured = process.env.ESKA_TEST_REFERENCE_ROOT;
if (configured && !isAbsolute(configured)) {
  throw new Error('ESKA_TEST_REFERENCE_ROOT must be absolute');
}

/** CI uses the exact backend release checkout; local development uses the sibling repository. */
export const formReferenceRoot = pathToFileURL(resolve(
  configured ?? fileURLToPath(new URL('../../eska/', import.meta.url)),
) + sep);
