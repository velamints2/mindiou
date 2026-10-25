// Production builds keep the Cognitive Loop runner behind an explicit flag.
// The public site should only expose the preview until the internal test pass
// is complete. Internal builds can opt in with VITE_ENABLE_COGNITIVE_LOOP=true.
export const ENABLE_COGNITIVE_LOOP = import.meta.env.VITE_ENABLE_COGNITIVE_LOOP === 'true'
