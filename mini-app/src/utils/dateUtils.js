// utils/dateUtils.js
export function getHoursWord(hours) {
  const lastDigit = hours % 10;
  const lastTwoDigits = hours % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'часов';
  }
  
  switch (lastDigit) {
    case 1: return 'час';
    case 2:
    case 3:
    case 4: return 'часа';
    default: return 'часов';
  }
}

export function getMinutesWord(minutes) {
  const lastDigit = minutes % 10;
  const lastTwoDigits = minutes % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'минут';
  }
  
  switch (lastDigit) {
    case 1: return 'минута';
    case 2:
    case 3:
    case 4: return 'минуты';
    default: return 'минут';
  }
}

export function getSecondsWord(seconds) {
  const lastDigit = seconds % 10;
  const lastTwoDigits = seconds % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'секунд';
  }
  
  switch (lastDigit) {
    case 1: return 'секунда';
    case 2:
    case 3:
    case 4: return 'секунды';
    default: return 'секунд';
  }
}