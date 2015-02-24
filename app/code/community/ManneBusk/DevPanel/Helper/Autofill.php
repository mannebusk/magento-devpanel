<?php
/**
 * DePanel Core Helper
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Helper_Autofill extends Mage_Core_Helper_Abstract
{
    /**
     * Get data to use for form autofiller
     *
     * @return array
     */
    public function getForms()
    {
        $externalDir    = $this->getFormAutofillDir();
        $dir            = Mage::getBaseDir('var') . DS . 'devpanel' . DS . 'form';
        $files          = glob($dir . DS . '*.json');
        $extFiles       = glob($externalDir . DS . '*.json');
        $files          = array_merge($files, $extFiles);

        $forms = array();

        foreach ($files as $file) {
            if (file_exists($file)) {
                $data = Mage::helper('core')->jsonDecode(file_get_contents($file));
                $name = basename($file, '.json');

                $forms[$name] = $data;
            }
        }
        return $forms;
    }

    /**
     * Get global dir for autofill files
     * 
     * @return string
     */
    public function getFormAutofillDir()
    {
        $dir = Mage::getModel('devpanel/config')->getConfig('form_autofill_dir');
        if (!$dir) {
            $dir = Mage::getModuleDir('Autofill', 'ManneBusk_DevPanel') . DS . 'Autofill';
        }

        return $dir;
    }

    /**
     * Get data to use for form autofiller
     *
     * @return string
     */
    public function getFormsAsJson()
    {
        return Mage::helper('core')->jsonEncode($this->getForms());
    }

    /**
     * Get html for form list items
     *
     * @return string
     */
    public function getFormsHtml()
    {
        $forms = $this->getForms();
        $html = "";
        foreach ($forms as $name => $form) {
            $html .= Mage::getBlockSingleton('core/template')
                ->setTemplate('devpanel/autofill/item.phtml')
                ->setForm($form)
                ->setFormName($name)
                ->toHtml();
        }

        return $html;
    }
}
