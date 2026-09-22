import { setup } from '../src/background/index';

export default defineBackground({
  type: 'module',
  main: setup,
});
