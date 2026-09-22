import './content.css';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  cssInjectionMode: 'manifest',
  async main() {
    const { main } = await import('../../src/content/index');
    await main();
  },
});
