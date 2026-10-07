import { useRef } from 'react';

/** Object literals only: class instances and React elements are opaque. */
function isPlainRecord(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && !('$$typeof' in value);
}

/**
 * Deep equality for plain data: primitives, arrays and object literals.
 * Anything else — functions, class instances, React elements — is compared by
 * identity, so a client object or an element tree is never walked.
 */
export function isStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => isStructurallyEqual(item, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      isStructurallyEqual(leftRecord[key], rightRecord[key]),
  );
}

/**
 * Keep the previous reference while a freshly derived value is equal to it.
 *
 * Several workbench values are rebuilt on every chat reducer commit — a
 * filtered queue, the last few prompts — and come out identical while a run
 * streams. Handing the new array on defeats every memo and `useMemo` below it.
 * Meant for small plain data; see `isStructurallyEqual` for what is opaque.
 */
export function useStructuralValue<Value>(value: Value): Value {
  const stableRef = useRef(value);
  if (!isStructurallyEqual(stableRef.current, value)) {
    stableRef.current = value;
  }
  return stableRef.current;
}
