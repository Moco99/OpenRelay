const w = process.stdout.columns || 80
const BAR_FG = '\x1b[38;5;239m'
const BAR_BG = '\x1b[48;5;239m'
const RS = '\x1b[0m'
console.log(BAR_FG + '▄'.repeat(w) + RS)
console.log(BAR_BG + ' > Hello World' + '\x1b[K' + RS)
console.log(BAR_FG + '▀'.repeat(w) + RS)
