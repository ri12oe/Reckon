import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { usePathname } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTabHaptic } from '@/hooks/use-tab-haptic';

const tabs = [
  { name: 'index', href: '/', label: 'Walk' },
  { name: 'calibration', href: '/calibration', label: 'Calibration' },
  { name: 'map', href: '/map', label: 'Map' },
  { name: 'library', href: '/library', label: 'Library' },
] as const;

export default function AppTabs() {
  const pathname = usePathname();
  useTabHaptic();

  return (
    <Tabs>
      <TabSlot style={{ flex: 1, width: '100%' }} />
      <TabList asChild>
        <ThemedView type="backgroundElement" style={styles.list}>
          {tabs.map((tab) => {
            const focused = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <TabTrigger key={tab.name} name={tab.name} href={tab.href} style={styles.trigger}>
                <ThemedText type="small" themeColor={focused ? 'text' : 'textSecondary'}>
                  {tab.label}
                </ThemedText>
              </TabTrigger>
            );
          })}
        </ThemedView>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  trigger: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
});
