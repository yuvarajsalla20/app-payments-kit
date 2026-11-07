// A small stand-in for react-native: what the kit uses, with knobs for tests.
export const Platform = { OS: 'ios' as string, select: <T,>(o: Record<string, T>) => o[Platform.OS] };
export const opened: string[] = [];
export const Linking = { openURL: async (url: string) => void opened.push(url) };
type L = (s: string) => void;
export const appState = { listeners: new Set<L>() };
export const AppState = {
  addEventListener: (_: 'change', l: L) => {
    appState.listeners.add(l);
    return { remove: () => void appState.listeners.delete(l) };
  },
};
