import { AppState } from 'react-native';
import { AWAY_MS, LEAVE_MS } from './options';

/**
 * Resolves true when the app goes to the background and then comes back (the person left for the store's page and returned),
 * or false when it never leaves within LEAVE_MS (the page opened inside the app, or not at all) or is away longer than AWAY_MS.
 */
export const cameBack = () =>
  new Promise<boolean>((resolve) => {
    let left = false;
    const done = (v: boolean) => {
      clearTimeout(leave);
      clearTimeout(away);
      sub.remove();
      resolve(v);
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        if (left) done(true);
      } else left = true;
    });
    const leave = setTimeout(() => {
      if (!left) done(false);
    }, LEAVE_MS);
    const away = setTimeout(() => done(false), AWAY_MS);
  });
