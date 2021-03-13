import { useEffect, useState } from 'react';


export function useDebounce<T>(value: T, wait: number): T {
  let [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    let timeout = setTimeout(() => setDebouncedValue(value), wait);
    return () => clearTimeout(timeout);
  }, [value]);

  return debouncedValue;
}


export default useDebounce;
