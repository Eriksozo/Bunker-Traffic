# Sons de aumento, redução e pausa (Bunker para Mac)

Pedido do proprietário em 08/11/2026: tocar um som no Mac quando houver aumento, redução ou pausa, e ter pelo menos 5 opções de som por status nas configurações. Este documento registra as referências usadas e as regras que o app segue. O código fica em `mac/BunkerNotch/Sources/BunkerNotch/` (`AdjustSound.swift`, `SoundCatalog.swift`, `SoundSynth.swift`, `SoundSettingsView.swift`).

## O que o app faz

- Toca um som para cada **aumento**, **redução** e **pausa** de campanha que o resumo do notch mostra. Vale para o gestor (Malva/Meta) e para a ordem enviada pelo Bunker. Ativação não toca.
- A tela fica no menu do Bunker, em "Som em aumento, redução e pausa › Configurações de som…". Cada status tem 7 sons e a opção "Nenhum", com prévia ao clicar, volume próprio do app (sem mexer no volume do sistema) e "Restaurar padrão". A escolha fica salva só neste Mac.
- O som só complementa: o aviso continua no notch e na notificação.
- Não toca:
  - no primeiro carregamento;
  - com "Silenciar avisos" ligado;
  - durante uma reunião (toca quando ela acaba);
  - quando o som do Bunker está desligado em Ajustes do Sistema › Notificações.
- Cada tipo toca uma vez por leitura, com no máximo um som por segundo. A notificação do mesmo ajuste fica silenciosa, inclusive o recibo de uma ordem confirmada, para nada tocar duas vezes.
- O app detecta como novo:
  - a mesma transição repetida depois (pausar, reativar, pausar de novo), pelo horário;
  - um ajuste fora dos 12 mais recentes, pelo aumento do contador de 24h daquele tipo.
- Limites:
  - o modo Foco do macOS não silencia sons tocados direto pelo app (inferência: a Apple não documenta esse caso), então use "Silenciar avisos";
  - o feed de atividade é de campanha, então ajustes de conjunto (ABO) não tocam;
  - o som segue o projeto escolhido no notch.

## Regras de desenho

| Regra | Como entrou no app | Fontes |
|---|---|---|
| O som só complementa a informação visual | Tudo continua no notch e na notificação | Apple HIG Notifications, Accessibility; Microsoft Win32 Sound; WCAG 1.4.2 |
| A direção melódica carrega o sentido | Aumento sobe, redução desce (espelho do mesmo motivo), pausa fica plana ou vai ao repouso | Material Sound attributes; MarketBuzz (Janata & Childs); Walker (polaridade em sonificação) |
| Cada status difere em mais de um atributo, nunca só no volume | Registro próprio (aumento Dó6–Sol6, redução Dó5–Sol5, pausa Dó4–Sol4), contorno, número de notas e timbre | Brewster, Wright & Edwards; Edworthy (contornos iguais se confundem) |
| Uma família só | Tom de Dó maior, intervalos consonantes (terça, quarta, quinta, oitava) | Material Sound choreography |
| Curto e sem estalo | 300–600 ms, notas ≥ 90 ms, ~6 notas/s no máximo, ataque de 5 ms e fade final; sons do macOS cortados em 0,7 s com fade | Brewster et al.; prática de síntese (ADSR) |
| Faixa de frequência confortável | Fundamentais de 260 Hz a 1,6 kHz; parciais acima de 5 kHz descartados; faixa de 2–5 kHz atenuada | Brewster; Microsoft (600 Hz–2 kHz); ISO 226 |
| Urgência proporcional | Aumento e redução são rotina (2–3 notas, sem repetição); pausa no máximo média (2–3 pulsos) | Edworthy, Loxley & Dennis 1991; Hellier et al. 1993; IEC 60601-1-8 |
| Contra fadiga de alerta | Um som por tipo e leitura, 1 s entre sons, mudo global, "Nenhum" por status, volume próprio | Android notifications (limite de 1 som/s); Joint Commission SEA 50; Apple HIG Playing audio |
| Escolha da pessoa | 7 opções e "Nenhum" por status, com prévia; padrão sutil | Material Applying sound to UI; Apple HIG Managing notifications |
| Sem áudio de terceiros no repositório | Sons do macOS lidos pelo nome em `/System/Library/Sounds`, os demais gerados em código | Apple NSSound `init(named:)` |

## Paleta

Os sons gerados normalizam a -6 dBFS, escalados pela nota mais forte. Com isso a redução sai um pouco mais suave e a pausa um pouco mais firme.

- **Aumento** (padrão: Subida suave)
  - gerados: Subida suave (terça maior Dó6→Mi6, marimba), Sino em quinta, Arpejo maior, Degrau digital
  - do macOS: Glass, Hero, Tink
- **Redução** (padrão: Descida suave)
  - gerados: Descida suave (terça maior Mi5→Dó5, marimba, espelho da subida), Quarta descendente, Sino descendente, Toque duplo descendente
  - do macOS: Bottle, Purr, Pop
- **Pausa** (padrão: Parada dupla)
  - gerados: Parada dupla (dois toques em Sol4), Descida ao repouso, Três toques graves, Fechamento em oitava
  - do macOS: Submarine, Funk, Basso (som de erro do macOS; não é o padrão porque pausa do gestor é rotina)

O autoteste do app (`mac/build.sh` → `--self-test`) confere:
- pelo menos 5 sons por status, além de "Nenhum";
- duração de 120–700 ms;
- pico ≤ -6 dBFS e nenhum valor inválido (NaN);
- cabeçalho WAV válido;
- existência de cada som do macOS e corte em 0,7 s;
- contorno de acordo com o sentido: aumento sobe, redução desce, pausa fica plana ou desce.

## Referências

Plataformas:
- Apple HIG — Notifications: https://developer.apple.com/design/human-interface-guidelines/notifications
- Apple HIG — Managing notifications (Foco, níveis de interrupção): https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Apple HIG — Playing audio: https://developer.apple.com/design/human-interface-guidelines/playing-audio
- Apple HIG — Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple — UNNotificationSound: https://developer.apple.com/documentation/usernotifications/unnotificationsound
- Apple — UNNotificationInterruptionLevel: https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel
- Apple — NSSound `init(named:)`: https://developer.apple.com/documentation/appkit/nssound/init(named:)
- Apple — AVAudioPlayer `init(data:)`: https://developer.apple.com/documentation/avfaudio/avaudioplayer/init(data:filetypehint:)
- Apple — INFocusStatusCenter: https://developer.apple.com/documentation/intents/infocusstatuscenter
- Apple Support — Configurar um Foco: https://support.apple.com/guide/mac-help/set-up-a-focus-to-stay-on-task-mchl613dc43f/mac
- Material Design 2 — About sound: https://m2.material.io/design/sound/about-sound.html
- Material Design 2 — Sound attributes: https://m2.material.io/design/sound/sound-attributes.html
- Material Design 2 — Applying sound to UI: https://m2.material.io/design/sound/applying-sound-to-ui.html
- Material Design 2 — Sound choreography: https://m2.material.io/design/sound/sound-choreography.html
- Microsoft — Win32 UX Guidelines, Sound: https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-sound
- Android — Create a notification (limite de som, alertar uma vez): https://developer.android.com/develop/ui/views/notifications/build-notification
- Android — Earcons (design): https://developer.android.com/design/ui/ai-glasses/guides/interaction/earcons
- W3C — WCAG 2.2, SC 1.4.2 Audio Control: https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html

Pesquisa:
- Blattner, Sumikawa & Greenberg (1989), Earcons and Icons: https://dblp.dagstuhl.de/rec/journals/sigchi/BlattnerSG89.html
- Brewster, Wright & Edwards, Guidelines for the Creation of Earcons: https://www.dcs.gla.ac.uk/~stephen/earcon_guidelines.shtml
- Gaver, Auditory Icons / SonicFinder: https://research.gold.ac.uk/id/eprint/15061
- Walker, Magnitude estimation of conceptual data dimensions for sonification: https://sonify.psych.gatech.edu/walkerb/research/phd/index.html
- Walker & Mauney (2010), Universal Design of Auditory Graphs: https://wirelessrerc.gatech.edu/node/341.html
- Ferguson & Brewster (CHI 2018), Perceptual congruence in sonification: https://eprints.gla.ac.uk/160589
- Janata & Childs (ICAD 2004), MarketBuzz — sonificação de dados financeiros: https://atonal.ucdavis.edu/publications/papers/janata_and_childs_icad_2004.pdf
- Edworthy, Loxley & Dennis (1991), urgência percebida em alarmes: https://researchportal.plymouth.ac.uk/en/publications/improving-auditory-warning-design-relationship-between-warning-so/
- Hellier, Edworthy & Dennis (1993): https://researchportal.plymouth.ac.uk/en/publications/improving-auditory-warning-design-quantifying-and-predicting-the-/
- IEC 60601-1-8 (prioridade por número de pulsos), resumo: https://www.digikey.at/en/ptm/m/mallory-sonalert-products-inc/iec60601-1-8-compliant-medical-alarms/tutorial?slide=15
- Edworthy, McDougall et al., alarmes hospitalares para a norma global: https://staffprofiles.bournemouth.ac.uk/display/journal-article/308096
- The Joint Commission, Sentinel Event Alert 50 (fadiga de alarme), resumo: https://reliasmedia.com/articles/65308-tjc-warns-about-alarm-fatigue-putting-patients-at-risk

Síntese:
- Curva de igual sonoridade (ISO 226): https://en.wikipedia.org/wiki/Equal-loudness_contour
- Envelope ADSR: https://en.wikipedia.org/wiki/Envelope_(music)
- Afinação de marimba (razões de parciais): https://lafavre.us/tuning-marimba.htm
- Formato WAVE PCM: https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/WAVE.html

Pontos não verificados nas fontes: o texto exato das páginas do Material (carregadas por JavaScript; vieram de resumos), as razões exatas dos parciais de sino e os milissegundos de fade (prática de engenharia, não norma).
