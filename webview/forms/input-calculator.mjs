// Taxi 8.3.27 Linux at 96 DPI: the numeric input uses a fixed 9x11 mark.
export const calculatorRects = [
  [1,0,7,1,'#4d4d4d'], [0,1,1,9,'#4d4d4d'], [8,1,1,9,'#4d4d4d'],
  [1,2,7,1,'#4d4d4d'], [1,10,7,1,'#4d4d4d'],
  [2,4,1,1,'#4d4d4d'], [4,4,1,1,'#4d4d4d'], [6,4,1,1,'#4d4d4d'],
  [2,6,1,1,'#4d4d4d'], [4,6,1,1,'#4d4d4d'], [6,6,1,3,'#4d4d4d'],
  [2,8,1,1,'#4d4d4d'], [4,8,1,1,'#4d4d4d'],
  [0,0,1,1,'#565656'], [8,0,1,1,'#565656'],
  [0,10,1,1,'#747474'], [8,10,1,1,'#747474'],
];

const inactiveColors = {'#4d4d4d':'#a4a4a4','#565656':'#a8a8a8','#747474':'#b7b7b7'};
export function calculatorFill(fill, inactive) { return inactive ? inactiveColors[fill] ?? fill : fill; }
