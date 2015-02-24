<?php
/**
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Block_Panel
    extends Mage_Core_Block_Template
{
    /**
     * Prepare Layout
     *
     * @return Mage_Core_Block_Template
     */
    protected function _prepareLayout()
    {
        $this->setAutoFill(Mage::helper('devpanel/autofill')->getForms());
        return parent::_prepareLayout();
    }

    /**
     * Get all tabs
     *
     * @return array
     */
    public function getTabs()
    {
        $children = $this->getSortedChildren();
        $tabs = array();
        foreach ($children as $child) {
            $child = $this->getChild($child);
            if ($child instanceof ManneBusk_DevPanel_Block_Tab) {
                $tabs[$child->getNameInLayout()] = $child;
            }
        }

        return $tabs;
    }

    /**
     * Get data to use for form autofiller
     *
     * @return string
     */
    public function getFormFillData()
    {
        return Mage::helper('devpanel/autofill')->getFormsAsJson();
    }
}
