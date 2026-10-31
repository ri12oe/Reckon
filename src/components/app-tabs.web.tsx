import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { usePathname } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon, type IconName } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTabHaptic } from '@/hooks/use-tab-haptic';
import { useTheme } from '@/hooks/use-theme';

const tabs: {
  name: string;
  href: '/' | '/calibration' | '/map' | '/library';
  label: string;
  icon: IconName;
}[] = [
  { name: 'index', href: '/', label: 'Walk', icon: 'walk' },
  { name: 'calibration', href: '/calibration', label: 'Calibration', icon: 'scope' },
  { name: 'map', href: '/map', label: 'Map', icon: 'map' },
  { name: 'library', href: '/library', label: 'Library', icon: 'library' },
];

/** Web stand-in for the iOS floating glass tab bar. */
export default function AppTabs() {
  const pathname = usePathname();
  const theme = useTheme();
  useTabHaptic();

  return (
    // TabList only registers TabTriggers that are its direct children.
    <Tabs style={{ flex: 1, backgroundColor: theme.background }}>
      <TabSlot style={{ flex: 1, width: '100%' }} />
      <TabList asChild>
        <Glass style={styles.bar}>
          {tabs.map((tab) => {
            const focused = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            const color = focused ? theme.accent : theme.text;
            return (
              <TabTrigger
                key={tab.name}
                name={tab.name}
                href={tab.href}
                accessibilityLabel={tab.label}
                style={[styles.trigger, focused && { backgroundColor: theme.glassSelected }]}
              >
                <Icon name={tab.icon} color={color} size={24} />
                <ThemedText type="caption" style={[styles.label, { color }]}>
                  {tab.label}
                </ThemedText>
              </TabTrigger>
            );
          })}
        </Glass>
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    padding: Spacing.one,
    borderRadius: 32,
  },
  trigger: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.two,
    borderRadius: 28,
  },
  label: {
    textTransform: 'none',
    letterSpacing: 0,
  },
});
