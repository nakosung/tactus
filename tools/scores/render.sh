#!/bin/sh
# Render the Mutopia LilyPond sources of the transcribed example songs to MIDI, with repeats written out.
# Needs git, LilyPond 2.24 and Python with mido. Run from this folder; writes *.midi here.
set -e
[ -d mp ] || { git clone -q --depth 1 --filter=blob:none --sparse https://github.com/MutopiaProject/MutopiaProject.git mp
  (cd mp && git sparse-checkout set --no-cone 'ftp/BeethovenLv/WoO59/fur_Elise_WoO59/*' 'ftp/SatieE/gymnopedie_1/*' \
    'ftp/JoplinS/entertainer/*' 'ftp/GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/*' 'ftp/PachelbelJ/Canon_per_3_Violini_e_Basso/*'); }
one() {  # $1 = source .ly, $2 = output name
  sed -e 's/\\score\s*{/\\score { \\unfoldRepeats/' -e 's/\\partcombine/\\partCombine/g' "$1" > "$(dirname "$1")/_u.ly"
  convert-ly -e -q "$(dirname "$1")/_u.ly" 2>/dev/null || true
  lilypond -s -dno-print-pages -o "$PWD/$2" "$(dirname "$1")/_u.ly"
}
one mp/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly fur_Elise_WoO59_u
one mp/ftp/SatieE/gymnopedie_1/gymnopedie_1.ly gymnopedie_1_u
one mp/ftp/JoplinS/entertainer/entertainer.ly entertainer_u
one mp/ftp/GriegE/O46/Dans_l_antre_du_roi_de_la_montagne/Dans_l_antre_du_roi_de_la_montagne.ly Dans_l_antre_du_roi_de_la_montagne_u
# the canon is several files; its main file includes the parts
( cd mp/ftp/PachelbelJ/Canon_per_3_Violini_e_Basso/Canon_per_3_Violini_e_Basso-lys && convert-ly -e -q canon_per_3_violini_e_basso.ly 2>/dev/null || true
  lilypond -s -dno-print-pages -o "$OLDPWD/canon3" canon_per_3_violini_e_basso.ly )
