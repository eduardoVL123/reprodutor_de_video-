# Fontes do app Roku

Roboto 3 (SIL Open Font License 1.1, `OFL.txt`), a fonte que as outras TVs mostram (Android TV) e que os mockups do
design 2.0 pedem (`'Segoe UI', Roboto, ...`). A Roku não deixa usar a fonte do sistema com tamanho livre no simulador,
então o app leva a sua.

Os quatro pesos (400, 500, 600, 700) saem da fonte variável oficial do Google Fonts
(`google/fonts/ofl/roboto/Roboto[wdth,wght].ttf`), com largura 100:

```bash
python -c "from fontTools.ttLib import TTFont; from fontTools.varLib.instancer import instantiateVariableFont as i; [i(TTFont('Roboto[wdth,wght].ttf'), {'wght': w, 'wdth': 100}, updateFontNames=True).save(f'Roboto-{n}.ttf') for n, w in [('Regular', 400), ('Medium', 500), ('SemiBold', 600), ('Bold', 700)]]"
```
