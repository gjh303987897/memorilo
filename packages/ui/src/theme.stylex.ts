import * as stylex from '@stylexjs/stylex'

export const uiColors = stylex.defineVars({
  accent: 'rgb(0, 113, 227)',
  accentHover: 'rgb(0, 105, 211)',
  accentPressed: 'rgb(0, 91, 187)',
  accentSoft: 'rgba(0, 113, 227, 0.1)',
  accentBackgroundImage: 'linear-gradient(180deg, rgb(34, 144, 255), rgb(0, 113, 227))',
  canvas: 'rgb(250, 250, 249)',
  controlBackground: 'transparent',
  controlBackgroundImage: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.36) 62%, rgba(174, 215, 255, 0.16))',
  controlHover: 'rgba(76, 84, 96, 0.07)',
  controlPressed: 'rgba(80, 91, 108, 0.14)',
  controlSelected: 'rgba(0, 113, 227, 0.9)',
  controlSelectedHover: 'rgb(0, 105, 211)',
  controlSelectedPressed: 'rgb(0, 91, 187)',
  controlSelectedText: 'white',
  navSelectedBackground: 'rgba(0, 113, 227, 0.9)',
  navSelectedIndicator: 'transparent',
  navSelectedIndicatorWidth: '0px',
  chromeBackground: 'transparent',
  chromeBorder: 'transparent',
  chromeBorderWidth: '0px',
  controlShadow: 'inset 0 1px rgba(255, 255, 255, 0.54), 0 1px 2px rgba(35, 42, 52, 0.06)',
  danger: 'rgb(166, 53, 53)',
  divider: 'rgba(55, 61, 70, 0.11)',
  fieldBackground: 'rgba(255, 255, 255, 0.78)',
  fieldBackgroundCompact: 'rgba(255, 255, 255, 0.76)',
  fieldBorder: 'rgba(71, 76, 86, 0.2)',
  focus: 'rgba(41, 97, 194, 0.84)',
  border: 'rgba(71, 76, 86, 0.2)',
  borderStrong: 'rgba(46, 51, 59, 0.5)',
  materialFilter: 'blur(20px) saturate(170%)',
  materialDecorationOpacity: '1',
  overlay: 'rgba(28, 31, 38, 0.2)',
  overlayStrong: 'rgba(28, 31, 38, 0.28)',
  overlayShadow: '0 20px 48px rgba(26, 32, 42, 0.22), 0 4px 12px rgba(26, 32, 42, 0.1)',
  onAccent: 'white',
  onDanger: 'white',
  onSuccess: 'white',
  onWarning: 'rgb(32, 24, 0)',
  placeholder: 'rgba(55, 57, 63, 0.46)',
  shadowRaised: '0 20px 48px rgba(26, 32, 42, 0.22), 0 4px 12px rgba(26, 32, 42, 0.1)',
  shadowSubtle: '0 4px 12px rgba(24, 30, 40, 0.1)',
  scrollEdgeMask: 'linear-gradient(to bottom, #000 0 72%, transparent 100%)',
  scrollEdgeShadow: 'none',
  sidebarBackground: 'rgba(244, 246, 249, 0.5)',
  sidebarBorderBottomWidth: '1px',
  sidebarBorderLeftWidth: '1px',
  sidebarBorderRightWidth: '1px',
  sidebarBorderTopWidth: '1px',
  sidebarInsetBlock: '8px',
  sidebarInsetInlineStart: '8px',
  sidebarRadius: '12px',
  sidebarShadow: '0 20px 48px rgba(26, 32, 42, 0.22), 0 4px 12px rgba(26, 32, 42, 0.1)',
  statusSuccess: 'rgb(55, 92, 64)',
  surface: 'rgba(250, 250, 251, 0.9)',
  surfaceBackgroundImage: 'linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(245, 248, 252, 0.28))',
  surfaceOpaque: 'rgb(250, 251, 253)',
  surfaceRaised: 'rgba(250, 251, 253, 0.96)',
  surfaceSunken: 'rgba(229, 233, 240, 0.58)',
  surfaceTranslucent: 'rgba(244, 246, 249, 0.5)',
  text: 'rgba(27, 28, 31, 0.92)',
  textMuted: 'rgba(46, 48, 54, 0.64)',
  textQuiet: 'rgba(55, 57, 63, 0.46)',
  warning: 'rgb(153, 103, 0)',
  controlRadius: '9px',
  pillRadius: '999px',
  surfaceRadius: '12px',
  controlStroke: '1px',
  surfaceStroke: '1px',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  material: 'solid',
  navSelectedShadow: 'none',
  statusDangerSoft: 'rgba(166, 53, 53, 0.1)',
  statusInfoSoft: 'rgba(0, 113, 227, 0.1)',
  statusSuccessSoft: 'rgba(55, 92, 64, 0.1)',
  statusWarningSoft: 'rgba(153, 103, 0, 0.12)',
})

interface ThemeValues {
  accent: string
  accentBackgroundImage: string
  accentHover: string
  accentPressed: string
  accentSoft: string
  canvas: string
  controlBackground: string
  controlBackgroundImage: string
  controlHover: string
  controlPressed: string
  controlSelected: string
  controlSelectedHover: string
  controlSelectedPressed: string
  controlSelectedText: string
  navSelectedBackground: string
  navSelectedIndicator: string
  navSelectedIndicatorWidth: string
  navSelectedShadow: string
  statusDangerSoft: string
  statusInfoSoft: string
  statusSuccessSoft: string
  statusWarningSoft: string
  chromeBackground: string
  chromeBorder: string
  chromeBorderWidth: string
  controlShadow: string
  danger: string
  divider: string
  fieldBackground: string
  fieldBackgroundCompact: string
  fieldBorder: string
  focus: string
  border: string
  borderStrong: string
  materialFilter: string
  materialDecorationOpacity: string
  overlay: string
  overlayStrong: string
  overlayShadow: string
  onAccent: string
  onDanger: string
  onSuccess: string
  onWarning: string
  placeholder: string
  shadowRaised: string
  shadowSubtle: string
  scrollEdgeMask: string
  scrollEdgeShadow: string
  sidebarBackground: string
  sidebarBorderBottomWidth: string
  sidebarBorderLeftWidth: string
  sidebarBorderRightWidth: string
  sidebarBorderTopWidth: string
  sidebarInsetBlock: string
  sidebarInsetInlineStart: string
  sidebarRadius: string
  sidebarShadow: string
  statusSuccess: string
  surface: string
  surfaceBackgroundImage: string
  surfaceOpaque: string
  surfaceRaised: string
  surfaceSunken: string
  surfaceTranslucent: string
  text: string
  textMuted: string
  textQuiet: string
  warning: string
  controlRadius: string
  pillRadius: string
  surfaceRadius: string
  controlStroke: string
  surfaceStroke: string
  fontFamily: string
  material: string
}

const liquidLight: ThemeValues = {
  accent: 'rgb(0, 113, 227)',
  accentBackgroundImage: 'linear-gradient(180deg, rgb(34, 144, 255), rgb(0, 113, 227))',
  accentHover: 'rgb(0, 105, 211)',
  accentPressed: 'rgb(0, 91, 187)',
  accentSoft: 'rgba(0, 113, 227, 0.1)',
  canvas: 'rgb(250, 250, 249)',
  controlBackground: 'transparent',
  controlBackgroundImage: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.36) 62%, rgba(174, 215, 255, 0.16))',
  controlHover: 'rgba(76, 84, 96, 0.07)',
  controlPressed: 'rgba(80, 91, 108, 0.14)',
  controlSelected: 'rgba(0, 113, 227, 0.9)',
  controlSelectedHover: 'rgb(0, 105, 211)',
  controlSelectedPressed: 'rgb(0, 91, 187)',
  controlSelectedText: 'white',
  navSelectedBackground: 'rgba(0, 113, 227, 0.9)',
  navSelectedIndicator: 'transparent',
  navSelectedIndicatorWidth: '0px',
  chromeBackground: 'transparent',
  chromeBorder: 'transparent',
  chromeBorderWidth: '0px',
  controlShadow: 'inset 0 1px rgba(255, 255, 255, 0.54), 0 1px 2px rgba(35, 42, 52, 0.06)',
  danger: 'rgb(166, 53, 53)',
  divider: 'rgba(55, 61, 70, 0.11)',
  fieldBackground: 'rgba(255, 255, 255, 0.78)',
  fieldBackgroundCompact: 'rgba(255, 255, 255, 0.76)',
  fieldBorder: 'rgba(71, 76, 86, 0.2)',
  focus: 'rgba(41, 97, 194, 0.84)',
  border: 'rgba(71, 76, 86, 0.2)',
  borderStrong: 'rgba(46, 51, 59, 0.5)',
  materialFilter: 'blur(20px) saturate(170%)',
  materialDecorationOpacity: '1',
  overlay: 'rgba(28, 31, 38, 0.2)',
  overlayStrong: 'rgba(28, 31, 38, 0.28)',
  overlayShadow: '0 20px 48px rgba(26, 32, 42, 0.22), 0 4px 12px rgba(26, 32, 42, 0.1)',
  onAccent: 'white',
  onDanger: 'white',
  onSuccess: 'white',
  onWarning: 'rgb(32, 24, 0)',
  placeholder: 'rgba(55, 57, 63, 0.46)',
  shadowRaised: '0 20px 48px rgba(26, 32, 42, 0.22), 0 4px 12px rgba(26, 32, 42, 0.1)',
  shadowSubtle: '0 4px 12px rgba(24, 30, 40, 0.1)',
  scrollEdgeMask: 'linear-gradient(to bottom, #000 0 72%, transparent 100%)',
  scrollEdgeShadow: 'none',
  sidebarBackground: 'rgba(244, 246, 249, 0.5)',
  sidebarBorderBottomWidth: '1px',
  sidebarBorderLeftWidth: '1px',
  sidebarBorderRightWidth: '1px',
  sidebarBorderTopWidth: '1px',
  sidebarInsetBlock: '8px',
  sidebarInsetInlineStart: '8px',
  sidebarRadius: '12px',
  sidebarShadow: '0 20px 48px rgba(26, 32, 42, 0.22), 0 4px 12px rgba(26, 32, 42, 0.1)',
  statusSuccess: 'rgb(55, 92, 64)',
  surface: 'rgba(250, 250, 251, 0.9)',
  surfaceBackgroundImage: 'linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(245, 248, 252, 0.28))',
  surfaceOpaque: 'rgb(250, 251, 253)',
  surfaceRaised: 'rgba(250, 251, 253, 0.96)',
  surfaceSunken: 'rgba(229, 233, 240, 0.58)',
  surfaceTranslucent: 'rgba(244, 246, 249, 0.5)',
  text: 'rgba(27, 28, 31, 0.92)',
  textMuted: 'rgba(46, 48, 54, 0.64)',
  textQuiet: 'rgba(55, 57, 63, 0.46)',
  warning: 'rgb(153, 103, 0)',
  navSelectedShadow: 'none',
  statusDangerSoft: 'rgba(166, 53, 53, 0.1)',
  statusInfoSoft: 'rgba(0, 113, 227, 0.1)',
  statusSuccessSoft: 'rgba(55, 92, 64, 0.1)',
  statusWarningSoft: 'rgba(153, 103, 0, 0.12)',
  controlRadius: '9px',
  pillRadius: '999px',
  surfaceRadius: '12px',
  controlStroke: '1px',
  surfaceStroke: '1px',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  material: 'translucent',
}

const liquidDark: ThemeValues = { ...liquidLight, accent: 'rgb(112, 181, 255)', accentBackgroundImage: 'linear-gradient(180deg, rgb(112, 181, 255), rgb(80, 151, 232))', accentHover: 'rgb(139, 198, 255)', accentPressed: 'rgb(80, 151, 232)', accentSoft: 'rgba(112, 181, 255, 0.18)', border: 'rgba(255, 255, 255, 0.18)', borderStrong: 'rgba(255, 255, 255, 0.42)', canvas: 'rgb(18, 21, 27)', controlBackgroundImage: 'linear-gradient(145deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03))', controlHover: 'rgba(255, 255, 255, 0.08)', controlPressed: 'rgba(255, 255, 255, 0.14)', controlSelected: 'rgba(112, 181, 255, 0.86)', controlShadow: 'inset 0 1px rgba(255, 255, 255, 0.12), 0 1px 3px rgba(0, 0, 0, 0.24)', danger: 'rgb(255, 134, 134)', divider: 'rgba(255, 255, 255, 0.12)', fieldBackground: 'rgba(255, 255, 255, 0.09)', fieldBackgroundCompact: 'rgba(255, 255, 255, 0.12)', fieldBorder: 'rgba(255, 255, 255, 0.18)', focus: 'rgba(139, 198, 255, 0.96)', overlay: 'rgba(0, 0, 0, 0.42)', overlayStrong: 'rgba(0, 0, 0, 0.58)', overlayShadow: '0 24px 64px rgba(0, 0, 0, 0.42), 0 4px 16px rgba(0, 0, 0, 0.28)', onAccent: 'rgb(14, 25, 40)', onDanger: 'rgb(28, 12, 12)', onSuccess: 'rgb(10, 28, 15)', placeholder: 'rgba(193, 202, 217, 0.54)', shadowRaised: '0 24px 64px rgba(0, 0, 0, 0.42), 0 4px 16px rgba(0, 0, 0, 0.28)', shadowSubtle: '0 4px 14px rgba(0, 0, 0, 0.28)', sidebarBackground: 'rgba(33, 39, 49, 0.78)', sidebarShadow: '0 24px 64px rgba(0, 0, 0, 0.42), 0 4px 16px rgba(0, 0, 0, 0.28)', statusSuccess: 'rgb(139, 221, 159)', surface: 'rgba(30, 35, 44, 0.94)', surfaceBackgroundImage: 'linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.02))', surfaceOpaque: 'rgb(38, 44, 55)', surfaceRaised: 'rgba(38, 44, 55, 0.98)', surfaceSunken: 'rgba(12, 15, 20, 0.52)', surfaceTranslucent: 'rgba(33, 39, 49, 0.78)', text: 'rgba(245, 247, 251, 0.94)', textMuted: 'rgba(218, 224, 235, 0.72)', textQuiet: 'rgba(193, 202, 217, 0.54)', warning: 'rgb(255, 194, 92)' }

const fluentLightBase: ThemeValues = { ...liquidLight, accent: 'rgb(15, 108, 189)', accentBackgroundImage: 'none', accentHover: 'rgb(17, 94, 163)', accentPressed: 'rgb(12, 78, 136)', accentSoft: 'rgb(235, 243, 252)', border: '#e0e0e0', borderStrong: '#616161', canvas: 'rgb(250, 250, 250)', controlBackground: 'rgb(255, 255, 255)', controlBackgroundImage: 'none', controlHover: 'rgba(0, 0, 0, 0.045)', controlPressed: 'rgba(0, 0, 0, 0.09)', controlSelected: 'rgb(235, 243, 252)', controlSelectedHover: 'rgb(225, 238, 252)', controlSelectedPressed: 'rgb(214, 231, 249)', controlSelectedText: 'rgb(36, 36, 36)', controlShadow: 'none', divider: 'rgb(225, 225, 225)', fieldBackground: 'rgb(255, 255, 255)', fieldBackgroundCompact: 'rgb(255, 255, 255)', fieldBorder: '#d1d1d1', focus: 'rgb(15, 108, 189)', materialDecorationOpacity: '0', materialFilter: 'none', overlayShadow: '0 8px 16px rgba(0, 0, 0, 0.14), 0 16px 32px rgba(0, 0, 0, 0.14)', scrollEdgeMask: 'none', scrollEdgeShadow: '0 1px 2px rgba(0, 0, 0, 0.1)', shadowRaised: '0 4px 8px rgba(0, 0, 0, 0.14), 0 8px 16px rgba(0, 0, 0, 0.14)', shadowSubtle: '0 1px 2px rgba(0, 0, 0, 0.14), 0 2px 4px rgba(0, 0, 0, 0.14)', sidebarBackground: 'rgb(243, 243, 243)', sidebarBorderBottomWidth: '0px', sidebarBorderLeftWidth: '0px', sidebarBorderRightWidth: '1px', sidebarBorderTopWidth: '0px', sidebarInsetBlock: '0px', sidebarInsetInlineStart: '0px', sidebarRadius: '0px', sidebarShadow: 'none', surface: 'rgb(255, 255, 255)', surfaceBackgroundImage: 'none', surfaceOpaque: 'rgb(255, 255, 255)', surfaceRaised: 'rgb(255, 255, 255)', surfaceSunken: 'rgb(243, 243, 243)', surfaceTranslucent: 'rgb(255, 255, 255)', text: 'rgb(36, 36, 36)', textMuted: 'rgb(80, 80, 80)', textQuiet: 'rgb(110, 110, 110)', onAccent: 'rgb(255, 255, 255)', controlRadius: '4px', pillRadius: '999px', surfaceRadius: '8px', controlStroke: '1px', surfaceStroke: '1px', material: 'solid', statusDangerSoft: '#fdf3f4', statusInfoSoft: '#eff6fc', statusSuccessSoft: '#f1faf1', statusWarningSoft: '#fff9f5' }
const fluentLight: ThemeValues = { ...fluentLightBase, controlSelected: 'rgb(234, 234, 234)', controlSelectedHover: 'rgb(226, 226, 226)', controlSelectedPressed: 'rgb(216, 216, 216)', navSelectedBackground: '#e0e0e0', navSelectedIndicator: 'rgb(15, 108, 189)', navSelectedIndicatorWidth: '2px', chromeBackground: 'rgb(255, 255, 255)', chromeBorder: 'rgb(225, 225, 225)', chromeBorderWidth: '1px', pillRadius: '4px', fontFamily: '"Segoe UI", system-ui, sans-serif', navSelectedShadow: 'none' }
const fluentDarkBase: ThemeValues = { ...fluentLight, accent: 'rgb(76, 194, 255)', accentHover: 'rgb(97, 205, 255)', accentPressed: 'rgb(43, 169, 230)', accentSoft: 'rgb(39, 51, 60)', border: '#666666', borderStrong: '#adadad', canvas: 'rgb(32, 32, 32)', controlBackground: 'rgb(41, 41, 41)', controlHover: 'rgba(255, 255, 255, 0.06)', controlPressed: 'rgba(255, 255, 255, 0.1)', controlSelected: 'rgb(39, 51, 60)', controlSelectedHover: 'rgb(44, 60, 72)', controlSelectedPressed: 'rgb(49, 68, 82)', controlSelectedText: 'rgb(255, 255, 255)', controlShadow: 'none', divider: 'rgba(255, 255, 255, 0.13)', fieldBackground: 'rgb(41, 41, 41)', fieldBackgroundCompact: 'rgb(48, 48, 48)', fieldBorder: '#666666', focus: 'rgb(76, 194, 255)', overlay: 'rgba(0, 0, 0, 0.42)', overlayStrong: 'rgba(0, 0, 0, 0.58)', overlayShadow: '0 8px 16px rgba(0, 0, 0, 0.28), 0 16px 32px rgba(0, 0, 0, 0.28)', placeholder: 'rgb(170, 170, 170)', scrollEdgeShadow: '0 2px 7px rgba(0, 0, 0, 0.3)', shadowRaised: '0 4px 8px rgba(0, 0, 0, 0.28), 0 8px 16px rgba(0, 0, 0, 0.28)', shadowSubtle: '0 1px 2px rgba(0, 0, 0, 0.28), 0 2px 4px rgba(0, 0, 0, 0.28)', sidebarBackground: 'rgb(37, 37, 37)', surface: 'rgb(41, 41, 41)', surfaceOpaque: 'rgb(50, 50, 50)', surfaceRaised: 'rgb(50, 50, 50)', surfaceSunken: 'rgb(28, 28, 28)', surfaceTranslucent: 'rgb(50, 50, 50)', text: 'rgb(255, 255, 255)', textMuted: 'rgb(210, 210, 210)', textQuiet: 'rgb(170, 170, 170)', onAccent: 'rgb(20, 20, 20)', statusDangerSoft: '#3b1a1a', statusInfoSoft: '#0f2a3d', statusSuccessSoft: '#143614', statusWarningSoft: '#3b2e0a' }
const fluentDark: ThemeValues = { ...fluentDarkBase, controlSelected: 'rgb(50, 50, 50)', controlSelectedHover: 'rgb(58, 58, 58)', controlSelectedPressed: 'rgb(66, 66, 66)', navSelectedBackground: '#3d3d3d', navSelectedIndicator: 'rgb(76, 194, 255)', navSelectedIndicatorWidth: '2px', chromeBackground: 'rgb(32, 32, 32)', chromeBorder: 'rgb(64, 64, 64)', chromeBorderWidth: '1px', navSelectedShadow: 'none' }

const neoLight: ThemeValues = { ...fluentLight, accent: 'rgb(255, 225, 53)', accentHover: 'rgb(255, 213, 32)', accentPressed: 'rgb(225, 185, 0)', accentSoft: 'rgb(255, 239, 176)', border: 'rgb(18, 18, 18)', borderStrong: 'rgb(18, 18, 18)', canvas: 'rgb(255, 248, 234)', controlHover: 'rgb(255, 239, 176)', controlPressed: 'rgb(255, 222, 116)', controlSelected: 'rgb(255, 225, 53)', controlSelectedHover: 'rgb(255, 213, 32)', controlSelectedPressed: 'rgb(225, 185, 0)', controlSelectedText: 'rgb(18, 18, 18)', controlShadow: '2px 2px 0 rgb(18, 18, 18)', divider: 'rgb(18, 18, 18)', fieldBackground: 'rgb(255, 255, 255)', fieldBackgroundCompact: 'rgb(255, 255, 255)', fieldBorder: 'rgb(18, 18, 18)', focus: 'rgb(18, 18, 18)', materialFilter: 'none', onAccent: 'rgb(18, 18, 18)', overlayShadow: '4px 4px 0 rgb(18, 18, 18)', scrollEdgeShadow: 'none', shadowRaised: '4px 4px 0 rgb(18, 18, 18)', shadowSubtle: '3px 3px 0 rgb(18, 18, 18)', sidebarBackground: 'rgb(255, 255, 255)', sidebarBorderBottomWidth: '0px', sidebarBorderLeftWidth: '0px', sidebarBorderRightWidth: '3px', sidebarBorderTopWidth: '0px', sidebarInsetBlock: '0px', sidebarInsetInlineStart: '0px', sidebarShadow: 'none', surface: 'rgb(255, 255, 255)', surfaceOpaque: 'rgb(255, 255, 255)', surfaceRaised: 'rgb(255, 255, 255)', surfaceSunken: 'rgb(255, 239, 176)', surfaceTranslucent: 'rgb(255, 255, 255)', text: 'rgb(18, 18, 18)', textMuted: 'rgb(58, 58, 58)', textQuiet: 'rgb(96, 96, 96)', warning: 'rgb(132, 75, 0)', controlRadius: '0px', pillRadius: '0px', surfaceRadius: '0px', controlStroke: '2px', surfaceStroke: '2px', material: 'hard-flat', navSelectedShadow: 'none', statusDangerSoft: 'rgb(255, 236, 236)', statusInfoSoft: 'rgb(255, 239, 176)', statusSuccessSoft: 'rgb(236, 255, 236)', statusWarningSoft: 'rgb(255, 236, 158)' }
const neoDark: ThemeValues = { ...neoLight, accent: 'rgb(255, 225, 53)', accentHover: 'rgb(255, 237, 115)', accentPressed: 'rgb(224, 191, 0)', accentSoft: 'rgb(65, 65, 65)', border: 'rgb(255, 255, 255)', borderStrong: 'rgb(255, 255, 255)', canvas: 'rgb(28, 28, 28)', controlBackground: 'rgb(42, 42, 42)', controlHover: 'rgb(65, 65, 65)', controlPressed: 'rgb(88, 88, 88)', controlShadow: '2px 2px 0 rgb(255, 255, 255)', divider: 'rgb(255, 255, 255)', fieldBackground: 'rgb(42, 42, 42)', fieldBackgroundCompact: 'rgb(42, 42, 42)', fieldBorder: 'rgb(255, 255, 255)', focus: 'rgb(255, 225, 53)', overlayShadow: '4px 4px 0 rgb(255, 255, 255)', placeholder: 'rgb(175, 175, 175)', shadowRaised: '4px 4px 0 rgb(255, 255, 255)', shadowSubtle: '3px 3px 0 rgb(255, 255, 255)', sidebarBackground: 'rgb(42, 42, 42)', surface: 'rgb(42, 42, 42)', surfaceOpaque: 'rgb(52, 52, 52)', surfaceRaised: 'rgb(52, 52, 52)', surfaceSunken: 'rgb(22, 22, 22)', surfaceTranslucent: 'rgb(42, 42, 42)', text: 'rgb(255, 255, 255)', textMuted: 'rgb(224, 224, 224)', textQuiet: 'rgb(175, 175, 175)', warning: 'rgb(255, 225, 53)', navSelectedShadow: 'none', statusDangerSoft: 'rgb(74, 42, 42)', statusInfoSoft: 'rgb(65, 65, 65)', statusSuccessSoft: 'rgb(42, 74, 42)', statusWarningSoft: 'rgb(65, 56, 26)' }

const neoLightThemeValues: ThemeValues = { ...neoLight, accent: 'rgb(255, 210, 63)', accentHover: 'rgb(255, 198, 42)', accentPressed: 'rgb(231, 172, 0)', accentSoft: 'rgb(255, 236, 158)', border: 'rgb(0, 0, 0)', borderStrong: 'rgb(0, 0, 0)', canvas: 'rgb(255, 253, 245)', controlHover: 'rgb(255, 236, 158)', controlPressed: 'rgb(255, 220, 105)', controlSelected: 'rgb(255, 210, 63)', controlSelectedHover: 'rgb(255, 198, 42)', controlSelectedPressed: 'rgb(231, 172, 0)', controlSelectedText: 'rgb(0, 0, 0)', controlShadow: '5px 5px 0 rgb(0, 0, 0)', divider: 'rgb(0, 0, 0)', fieldBorder: 'rgb(0, 0, 0)', focus: 'rgb(0, 0, 0)', overlayShadow: '8px 8px 0 rgb(0, 0, 0)', shadowRaised: '8px 8px 0 rgb(0, 0, 0)', shadowSubtle: '3px 3px 0 rgb(0, 0, 0)', sidebarBackground: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)', textMuted: 'rgb(47, 47, 47)', textQuiet: 'rgb(89, 89, 89)', warning: 'rgb(132, 75, 0)', navSelectedBackground: 'rgb(255, 210, 63)', navSelectedIndicator: 'rgb(0, 0, 0)', navSelectedIndicatorWidth: '0px', chromeBackground: 'rgb(255, 255, 255)', chromeBorder: 'rgb(0, 0, 0)', chromeBorderWidth: '3px', controlRadius: '0px', pillRadius: '0px', surfaceRadius: '0px', controlStroke: '3px', surfaceStroke: '3px', fontFamily: 'ui-sans-serif, system-ui, sans-serif', material: 'hard-flat' }
const neoDarkThemeValues: ThemeValues = { ...neoDark, accent: 'rgb(255, 210, 63)', accentHover: 'rgb(255, 224, 102)', accentPressed: 'rgb(226, 170, 0)', controlSelected: 'rgb(255, 210, 63)', controlSelectedHover: 'rgb(255, 224, 102)', controlSelectedPressed: 'rgb(226, 170, 0)', controlSelectedText: 'rgb(0, 0, 0)', controlShadow: '5px 5px 0 rgb(255, 255, 255)', focus: 'rgb(255, 210, 63)', overlayShadow: '8px 8px 0 rgb(255, 255, 255)', shadowRaised: '8px 8px 0 rgb(255, 255, 255)', navSelectedBackground: 'rgb(255, 210, 63)', navSelectedIndicator: 'rgb(255, 255, 255)', navSelectedIndicatorWidth: '0px', chromeBackground: 'rgb(28, 28, 28)', chromeBorder: 'rgb(255, 255, 255)', chromeBorderWidth: '3px', controlRadius: '0px', pillRadius: '0px', surfaceRadius: '0px', controlStroke: '3px', surfaceStroke: '3px', material: 'hard-flat' }

const liquidGlassLightTheme = stylex.createTheme(uiColors, liquidLight)
const liquidGlassDarkTheme = stylex.createTheme(uiColors, liquidDark)
const fluentLightTheme = stylex.createTheme(uiColors, fluentLight)
const fluentDarkTheme = stylex.createTheme(uiColors, fluentDark)
const neubrutalismLightTheme = stylex.createTheme(uiColors, neoLightThemeValues)
const neubrutalismDarkTheme = stylex.createTheme(uiColors, neoDarkThemeValues)

const themeClasses = {
  'liquid-glass': { dark: liquidGlassDarkTheme, light: liquidGlassLightTheme },
  'fluent': { dark: fluentDarkTheme, light: fluentLightTheme },
  'neubrutalism': { dark: neubrutalismDarkTheme, light: neubrutalismLightTheme },
} as const

export type UiThemeFamily = keyof typeof themeClasses
export type UiThemeAppearance = keyof typeof themeClasses['liquid-glass']

export interface UiThemeDefinition<Id extends string = string> {
  readonly id: Id
  readonly labelKey: string
  readonly descriptionKey: string
  readonly preview: { readonly accent: string, readonly canvas: string, readonly surface: string }
  readonly cssVariables: Readonly<Record<UiThemeAppearance, Readonly<Record<string, string>>>>
  readonly themes: typeof themeClasses['liquid-glass']
}

function themeCssVariables(values: ThemeValues): Readonly<Record<string, string>> {
  return {
    '--ui-accent': values.accent,
    '--ui-accent-background-image': values.accentBackgroundImage,
    '--ui-accent-foreground': values.material === 'hard-flat' ? values.text : values.accent,
    '--ui-accent-hover': values.accentHover,
    '--ui-accent-pressed': values.accentPressed,
    '--ui-accent-soft': values.accentSoft,
    '--ui-border': values.border,
    '--ui-border-strong': values.borderStrong,
    '--ui-canvas': values.canvas,
    '--ui-control-background': values.controlBackground,
    '--ui-control-background-image': values.controlBackgroundImage,
    '--ui-control-hover': values.controlHover,
    '--ui-control-pressed': values.controlPressed,
    '--ui-control-radius': values.controlRadius,
    '--ui-control-selected': values.controlSelected,
    '--ui-control-selected-hover': values.controlSelectedHover,
    '--ui-control-selected-pressed': values.controlSelectedPressed,
    '--ui-control-selected-text': values.controlSelectedText,
    '--ui-nav-selected-background': values.navSelectedBackground,
    '--ui-nav-selected-indicator': values.navSelectedIndicator,
    '--ui-nav-selected-indicator-width': values.navSelectedIndicatorWidth,
    '--ui-chrome-background': values.chromeBackground,
    '--ui-chrome-border': values.chromeBorder,
    '--ui-chrome-border-width': values.chromeBorderWidth,
    '--ui-control-shadow': values.controlShadow,
    '--ui-control-stroke': values.controlStroke,
    '--ui-danger': values.danger,
    '--ui-divider': values.divider,
    '--ui-field-background': values.fieldBackground,
    '--ui-field-background-compact': values.fieldBackgroundCompact,
    '--ui-field-border': values.fieldBorder,
    '--ui-focus': values.focus,
    '--ui-material-filter': values.materialFilter,
    '--ui-material-decoration-opacity': values.materialDecorationOpacity,
    '--ui-on-accent': values.onAccent,
    '--ui-on-danger': values.onDanger,
    '--ui-on-success': values.onSuccess,
    '--ui-on-warning': values.onWarning,
    '--ui-overlay': values.overlay,
    '--ui-overlay-strong': values.overlayStrong,
    '--ui-overlay-shadow': values.overlayShadow,
    '--ui-placeholder': values.placeholder,
    '--ui-pill-radius': values.pillRadius,
    '--ui-shadow-raised': values.shadowRaised,
    '--ui-shadow-subtle': values.shadowSubtle,
    '--ui-scroll-edge-mask': values.scrollEdgeMask,
    '--ui-scroll-edge-shadow': values.scrollEdgeShadow,
    '--ui-sidebar-background': values.sidebarBackground,
    '--ui-sidebar-border-bottom-width': values.sidebarBorderBottomWidth,
    '--ui-sidebar-border-left-width': values.sidebarBorderLeftWidth,
    '--ui-sidebar-border-right-width': values.sidebarBorderRightWidth,
    '--ui-sidebar-border-top-width': values.sidebarBorderTopWidth,
    '--ui-sidebar-inset-block': values.sidebarInsetBlock,
    '--ui-sidebar-inset-inline-start': values.sidebarInsetInlineStart,
    '--ui-sidebar-radius': values.sidebarRadius,
    '--ui-sidebar-shadow': values.sidebarShadow,
    '--ui-surface': values.surface,
    '--ui-surface-background-image': values.surfaceBackgroundImage,
    '--ui-surface-opaque': values.surfaceOpaque,
    '--ui-surface-raised': values.surfaceRaised,
    '--ui-surface-radius': values.surfaceRadius,
    '--ui-surface-stroke': values.surfaceStroke,
    '--ui-surface-sunken': values.surfaceSunken,
    '--ui-surface-translucent': values.surfaceTranslucent,
    '--ui-text': values.text,
    '--ui-text-muted': values.textMuted,
    '--ui-text-quiet': values.textQuiet,
    '--ui-status-success': values.statusSuccess,
    '--ui-status-danger-soft': values.statusDangerSoft,
    '--ui-status-info-soft': values.statusInfoSoft,
    '--ui-status-success-soft': values.statusSuccessSoft,
    '--ui-status-warning-soft': values.statusWarningSoft,
    '--ui-nav-selected-shadow': values.navSelectedShadow,
    '--ui-warning': values.warning,
    '--ui-font-family': values.fontFamily,
    '--ui-material': values.material,
  }
}

export const uiThemeDefinitions = [
  {
    id: 'liquid-glass',
    labelKey: 'themeLiquidGlass',
    descriptionKey: 'themeLiquidGlassDescription',
    preview: { accent: liquidLight.accent, canvas: liquidLight.canvas, surface: liquidLight.surface },
    cssVariables: { dark: themeCssVariables(liquidDark), light: themeCssVariables(liquidLight) },
    themes: themeClasses['liquid-glass'],
  },
  {
    id: 'fluent',
    labelKey: 'themeFluent',
    descriptionKey: 'themeFluentDescription',
    preview: { accent: fluentLight.accent, canvas: fluentLight.canvas, surface: fluentLight.surface },
    cssVariables: { dark: themeCssVariables(fluentDark), light: themeCssVariables(fluentLight) },
    themes: themeClasses.fluent,
  },
  {
    id: 'neubrutalism',
    labelKey: 'themeNeubrutalism',
    descriptionKey: 'themeNeubrutalismDescription',
    preview: { accent: neoLightThemeValues.accent, canvas: neoLightThemeValues.canvas, surface: neoLightThemeValues.surface },
    cssVariables: { dark: themeCssVariables(neoDarkThemeValues), light: themeCssVariables(neoLightThemeValues) },
    themes: themeClasses.neubrutalism,
  },
] satisfies readonly UiThemeDefinition<UiThemeFamily>[]

const registeredThemeDefinitions = new Map<string, UiThemeDefinition>(
  uiThemeDefinitions.map(definition => [definition.id, definition]),
)

function registeredThemeDefinition(id: string): UiThemeDefinition {
  const definition = registeredThemeDefinitions.get(id) ?? registeredThemeDefinitions.get('liquid-glass')
  if (!definition)
    throw new Error('Liquid Glass theme definition is not registered')
  return definition
}

export function getUiThemeDefinitions(): readonly UiThemeDefinition[] {
  return [...registeredThemeDefinitions.values()]
}

export function registerUiThemeDefinition(definition: UiThemeDefinition): () => void {
  if (registeredThemeDefinitions.has(definition.id))
    throw new Error(`UI theme definition already registered: ${definition.id}`)
  registeredThemeDefinitions.set(definition.id, definition)
  return () => {
    registeredThemeDefinitions.delete(definition.id)
  }
}

export const uiThemes = {
  light: themeClasses['liquid-glass'].light,
  midnight: themeClasses['liquid-glass'].dark,
} as const

export type UiThemeName = keyof typeof uiThemes

export const uiMotion = {
  duration: {
    'default': '110ms',
    '@media (prefers-reduced-motion: reduce)': '0ms',
  },
  easing: 'ease-out',
} as const

export function getUiThemeClass(family: UiThemeFamily, appearance: UiThemeAppearance): string {
  return stylex.props(registeredThemeDefinition(family).themes[appearance]).className ?? ''
}

export function getUiThemeCssVariables(family: UiThemeFamily, appearance: UiThemeAppearance): Readonly<Record<string, string>> {
  return registeredThemeDefinition(family).cssVariables[appearance]
}
