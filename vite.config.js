export default ({ command }) => ({
  base: command === 'build' ? '/java-notebook/' : '/',
  build: { outDir: 'dist' }
})
