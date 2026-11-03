-- Repart sur un tour neuf : tous les noms redeviennent disponibles.
-- Les tirages de l’ancien tour restent en base mais ne sont plus accessibles via le site.
update public.game set round = round + 1;
