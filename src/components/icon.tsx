import { SymbolView } from 'expo-symbols';
import { type ColorValue } from 'react-native';

/** SF Symbols on iOS, Material Symbols on Android and web. */
const symbols = {
  pin: { ios: 'mappin', android: 'location_on', web: 'location_on' },
  locate: { ios: 'location.fill', android: 'near_me', web: 'near_me' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  fit: {
    ios: 'arrow.up.left.and.arrow.down.right',
    android: 'fit_screen',
    web: 'fit_screen',
  },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'ios_share' },
  more: { ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' },
  ruler: { ios: 'ruler', android: 'straighten', web: 'straighten' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  appearance: { ios: 'circle.lefthalf.filled', android: 'contrast', web: 'contrast' },
  walk: { ios: 'figure.walk', android: 'directions_walk', web: 'directions_walk' },
  scope: { ios: 'scope', android: 'my_location', web: 'my_location' },
  map: { ios: 'map', android: 'map', web: 'map' },
  library: { ios: 'books.vertical', android: 'library_books', web: 'library_books' },
} as const;

export type IconName = keyof typeof symbols;

type Props = {
  name: IconName;
  color: ColorValue;
  size?: number;
};

export function Icon({ name, color, size = 22 }: Props) {
  return (
    <SymbolView
      name={symbols[name]}
      tintColor={color}
      size={size}
      weight="medium"
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
